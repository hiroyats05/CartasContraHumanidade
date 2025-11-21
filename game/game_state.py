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

    def __init__(self, players: List[Player], deck: Deck, hand_size: int = 5) -> None:
        self.players: List[Player] = players
        self.deck: Deck = deck
        self.discard: List[Card] = []
        self.turns: TurnManager = TurnManager([p.id for p in players])
        self.hand_size = hand_size
        self.started = False
        # submissões de cartas nesta rodada: player_id -> Card
        self.submissions: Dict[str, Card] = {}
        # sessão de votação atual, é criada quando todas as submissões são feitas
        self.voting: Optional[VotingSession] = None
        self.voting_open: bool = False

    def start(self) -> None:
        self.deck.shuffle()
        for p in self.players:
            p.clear_hand()
            p.draw(self.deck, self.hand_size)
        self.started = True

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
        player = self._get_player(player_id)
        card = player.play(card_index)
        self.submissions[player_id] = card
        # se todos submeteram, inicializa sessão de votação
        if len(self.submissions) == len(self.players):
            self.voting = VotingSession(self.submissions)
            self.voting_open = True

    def deal_one_to(self, player_id: str) -> None:
        player = self._get_player(player_id)
        player.draw(self.deck, 1)

    def _get_player(self, player_id: str) -> Player:
        for p in self.players:
            if p.id == player_id:
                return p
        raise ValueError(f"Player with id {player_id!r} not found")

    def snapshot(self) -> dict:
        return {
            "players": [{"id": p.id, "name": p.name, "hand_count": len(p.hand), "score": p.score} for p in self.players],
            "deck_count": len(self.deck),
            "discard_count": len(self.discard),
            "current_turn": self.turns.current(),
            "submissions": list(self.submissions.keys()),
            "voting_open": self.voting_open,
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
            winner_id = self.voting.winner()
            if winner_id is not None:
                winner = self._get_player(winner_id)
                winner.score += 1
            # mover submissões para descarte
            for c in self.submissions.values():
                self.discard.append(c)
            # limpar estado de rodada
            self.submissions.clear()
            self.voting = None
            self.voting_open = False
            # reabastecer mãos até hand_size
            for p in self.players:
                while len(p.hand) < self.hand_size and not self.deck.is_empty():
                    p.draw(self.deck, 1)
            return winner_id
        return None
