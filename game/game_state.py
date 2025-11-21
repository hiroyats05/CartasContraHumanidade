from typing import List, Dict, Optional

from .card import Card
from .deck import Deck
from .player import Player
from .turn_manager import TurnManager
from .voting import VotingSession


class GameState:
    """Estado principal do jogo: jogadores, deck, pilha de descarte e turnos.

    Responsável por operações de alto nível como iniciar jogo e jogar cartas.
    """

    def __init__(self, players: List[Player], white_deck: Deck, black_deck: Optional[Deck] = None, hand_size: int = 3) -> None:
        self.players: List[Player] = players
        self.white_deck: Deck = white_deck
        self.black_deck: Optional[Deck] = black_deck
        self.discard: List[Card] = []
        # descarte separado para cartas pretas (prompt cards)
        self.black_discard: List[Card] = []
        self.turns: TurnManager = TurnManager([p.id for p in players])
        self.hand_size = hand_size
        self.started = False
        # submissões de cartas nesta rodada: player_id -> Card
        self.submissions: Dict[str, Card] = {}
        # sessão de votação atual, é criada quando todas as submissões são feitas
        self.voting: Optional[VotingSession] = None
        self.voting_open: bool = False
        # suporte a múltiplas rodadas
        self.max_rounds: Optional[int] = None  # None = infinito
        self.current_round: int = 0

    def start(self) -> None:
        # shuffle available decks
        try:
            if self.white_deck:
                self.white_deck.shuffle()
        except Exception:
            pass
        try:
            if self.black_deck:
                self.black_deck.shuffle()
        except Exception:
            pass
        self.current_round = 0
        for p in self.players:
            p.clear_hand()
            # garantir que cada jogador receba exatamente `hand_size` cartas
            for _ in range(self.hand_size):
                self._replenish_deck_if_needed()
                if self.white_deck.is_empty():
                    # se mesmo após tentar reabastecer não houver cartas, paramos
                    break
                p.draw(self.white_deck, 1)
        self.started = True
        # draw a black card for the round (if available)
        self.current_black_card: Optional[Card] = None
        if self.black_deck:
            try:
                # ensure black deck has cards (replenish from black_discard if needed)
                try:
                    self._replenish_black_if_needed()
                except Exception:
                    pass
                # draw a random black card from the black deck so prompts are not predictable
                try:
                    self.current_black_card = self.black_deck.draw_random_black()
                except Exception:
                    # fallback to the older methods if random draw not available
                    maybe = self.black_deck.draw(1)
                    if maybe:
                        self.current_black_card = maybe[0]
                    else:
                        try:
                            self.current_black_card = self.black_deck.draw_black()
                        except Exception:
                            self.current_black_card = None
            except Exception:
                self.current_black_card = None

    def play_card(self, player_id: str, card_index: int) -> Card:
        """API antiga (mantida para compatibilidade): joga imediatamente para descarte.

        Use `submit_card` para fluxo de votação.
        """
        player = self._get_player(player_id)
        card = player.play(card_index)
        self.discard.append(card)
        self.turns.advance()
        return card

    def submit_card(self, player_id: str, card_index: int) -> None:
        """Submete uma carta para a votação desta rodada.

        Quando todas as submissões forem recebidas, abre a votação automaticamente.
        """
        if player_id in self.submissions:
            raise ValueError(f"Player {player_id!r} already submitted for this round")
        if self.is_finished():
            raise RuntimeError("Game has finished; cannot submit cards")
        player = self._get_player(player_id)
        card = player.play(card_index)
        self.submissions[player_id] = card
        # se todos submeteram, inicializa sessão de votação
        if len(self.submissions) == len(self.players):
            # todos os jogadores votam; permite votar mesmo para quem não submeteu
            voter_ids = [p.id for p in self.players]
            self.voting = VotingSession(self.submissions, voters=voter_ids)
            self.voting_open = True

    def _replenish_black_if_needed(self) -> None:
        """Se o baralho preto estiver vazio e houver cartas no descarte preto, move-as de volta e embaralha."""
        if self.black_deck is None:
            return
        if self.black_deck.is_empty() and self.black_discard:
            try:
                self.black_deck.add_many(self.black_discard)
                self.black_deck.shuffle()
                self.black_discard.clear()
            except Exception:
                # se algo falhar, garantimos que não levantamos exceção para o fluxo normal
                pass

    def deal_one_to(self, player_id: str) -> None:
        player = self._get_player(player_id)
        player.draw(self.white_deck, 1)

    def _get_player(self, player_id: str) -> Player:
        for p in self.players:
            if p.id == player_id:
                return p
        raise ValueError(f"Player with id {player_id!r} not found")

    def snapshot(self) -> dict:
        return {
            "players": [{"id": p.id, "name": p.name, "hand_count": len(p.hand), "score": p.score} for p in self.players],
            "white_deck_count": len(self.white_deck),
            "discard_count": len(self.discard),
            "current_turn": self.turns.current(),
            "submissions": list(self.submissions.keys()),
            "submission_texts": {pid: getattr(card, 'text', str(card)) for pid, card in self.submissions.items()},
            "voting_open": self.voting_open,
            "current_round": self.current_round,
            "max_rounds": self.max_rounds,
            "black_card_text": getattr(self, 'current_black_card', None) and getattr(self.current_black_card, 'text', None),
        }

    def cast_vote(self, voter_id: str, voted_player_id: str) -> Optional[str]:
        """Registra o voto de `voter_id` para `voted_player_id`.

        Retorna o `player_id` vencedor quando a votação é concluída, ou None se ainda
        estiver aberta.
        """
        if not self.voting_open or self.voting is None:
            raise RuntimeError("No active voting session")
        self.voting.cast_vote(voter_id, voted_player_id)
        # quando todos votarem, resolve
        if len(self.voting.votes) == len(self.players):
            # apura resultados e detecta empate
            leading = self.voting.leading_candidates()
            if len(leading) == 1:
                winner_id = leading[0]
                winner = self._get_player(winner_id)
                winner.score += 1
                # mover submissões para descarte
                for c in self.submissions.values():
                    self.discard.append(c)
                # limpar estado de rodada
                self.submissions.clear()
                self.voting = None
                self.voting_open = False
                # cada jogador ganha exatamente 1 carta ao final da rodada (se houver no deck)
                for p in self.players:
                    # se o deck acabou, reembaralha o discard de volta no deck
                    self._replenish_deck_if_needed()
                    if not self.white_deck.is_empty():
                        p.draw(self.white_deck, 1)
                # incrementar o contador de rodadas
                self.current_round += 1
                # sortear uma nova carta preta para a próxima rodada (se houver baralho de pretas)
                if self.black_deck:
                    try:
                        # tenta tirar aleatoriamente uma carta preta
                        # antes de sortear, movemos a carta preta atual para o descarte (se existir)
                        if getattr(self, 'current_black_card', None):
                            try:
                                self.black_discard.append(self.current_black_card)
                            except Exception:
                                pass
                        try:
                            # garantir reabastecimento se necessário
                            try:
                                self._replenish_black_if_needed()
                            except Exception:
                                pass
                            self.current_black_card = self.black_deck.draw_random_black()
                        except Exception:
                            maybe = self.black_deck.draw(1)
                            if maybe:
                                self.current_black_card = maybe[0]
                            else:
                                try:
                                    self.current_black_card = self.black_deck.draw_black()
                                except Exception:
                                    self.current_black_card = None
                    except Exception:
                        self.current_black_card = None
                return winner_id
            else:
                # empate -> abre uma nova rodada de votação apenas entre os empatados
                tied_submissions = {pid: self.submissions[pid] for pid in leading}
                voter_ids = [p.id for p in self.players]
                self.voting = VotingSession(tied_submissions, voters=voter_ids)
                self.voting_open = True
                # mantém self.submissions (serão descartadas quando houver um vencedor)
                # as `votes` anteriores são descartadas porque `self.voting` foi substituída
                return None
        return None

    def is_finished(self) -> bool:
        """Retorna True se o jogo atingiu o número máximo de rodadas (quando configurado)."""
        if self.max_rounds is None:
            return False
        return self.current_round >= self.max_rounds

    def _replenish_deck_if_needed(self) -> None:
        """Se o deck estiver vazio e houver cartas no descarte, move-as para o deck e embaralha."""
        if self.white_deck.is_empty() and self.discard:
            # move todas as cartas do descarte para o deck branco e embaralha
            self.white_deck.add_many(self.discard)
            self.white_deck.shuffle()
            self.discard.clear()
