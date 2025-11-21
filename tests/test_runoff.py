import sys
import os

# garantir que a raiz do projeto está no sys.path quando executado como script
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from game.cards_data import make_cah_like_decks
from game.deck import Deck
from game.player import Player
from game.game_state import GameState


def test_runoff_tie_resolution():
    # cria decks de exemplo
    white_deck, black_deck = make_cah_like_decks()
    combined = Deck(list(white_deck.cards) + list(black_deck.cards))

    # 4 jogadores (par pode levar a empates; usamos 4 para simular o caso pedido)
    players = [Player("p1", "A"), Player("p2", "B"), Player("p3", "C"), Player("p4", "D")]
    gs = GameState(players, combined, hand_size=2)
    gs.start()

    # cada jogador submete a primeira carta que tem
    for p in players:
        gs.submit_card(p.id, 0)

    assert gs.voting_open is True

    # primeira rodada de votos: cria empate entre p1 e p2 (2-2)
    gs.cast_vote("p1", "p2")
    gs.cast_vote("p2", "p1")
    gs.cast_vote("p3", "p1")
    gs.cast_vote("p4", "p2")

    # após apuração, deve existir empate -> `voting_open` ainda True e sessão de runoff
    assert gs.voting_open is True
    # votação atual deve conter apenas os empatados (p1 e p2)
    assert set(gs.voting.submissions.keys()) == {"p1", "p2"}

    # runoff: votos que escolhem majoritariamente p1 (p1 não pode votar por si mesmo)
    gs.cast_vote("p1", "p2")  # p1 vota no outro
    gs.cast_vote("p2", "p1")
    gs.cast_vote("p3", "p1")
    gs.cast_vote("p4", "p1")

    # agora a votação foi resolvida
    assert gs.voting_open is False

    # o vencedor deve ser p1 e receber 1 ponto
    winner = next(p for p in gs.players if p.id == "p1")
    assert winner.score == 1

    # as submissões originais devem ter sido movidas para discard
    assert len(gs.discard) >= 4


if __name__ == "__main__":
    # permite execução direta sem pytest
    test_runoff_tie_resolution()
    print("test_runoff_tie_resolution: OK")
