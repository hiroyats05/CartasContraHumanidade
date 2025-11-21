"""Demo rápido para executar a lógica do cardgame no desktop (console)."""

from game.card import Card, CardType
from game.deck import Deck
from game.player import Player
from game.game_state import GameState
from game.cards_data import make_cah_like_decks


def make_standard_deck() -> tuple[Deck, Deck]:
    # Returns (white_deck, black_deck)
    return make_cah_like_decks()


def main() -> None:
    white_deck, black_deck = make_standard_deck()
    players = [Player("p1", "Alice"), Player("p2", "Bob")]
    # Create a combined deck for GameState (white + black mixed is fine), but
    # we'll draw black cards from the black_deck for prompts.
    combined = Deck(list(white_deck.cards) + list(black_deck.cards))
    gs = GameState(players, combined, hand_size=5)
    gs.start()
    print("Initial snapshot:", gs.snapshot())

    current = gs.turns.current()
    print("Current turn:", current)

    # Simula uma rodada típica: puxa um prompt (black card) e cada jogador
    # submete uma carta branca.
    black = black_deck.draw(1)
    if not black:
        print("No black cards available")
        return
    prompt = black[0]
    print("Prompt:", prompt.text)

    for p in players:
        # Para simplicidade do demo, cada jogador submete a primeira branca da mão
        # (assumindo que existem cartas brancas na mão)
        try:
            gs.submit_card(p.id, 0)
            print(f"{p.name} submitted a card")
        except Exception as e:
            print(f"{p.name} failed to submit: {e}")

    print("After submissions snapshot:", gs.snapshot())

    # Simula votação: cada jogador vota no outro (não pode votar em si mesmo)
    for voter in players:
        # encontre um candidato que não seja o próprio
        candidates = [pid for pid in gs.submissions.keys() if pid != voter.id]
        choice = candidates[0]
        winner = gs.cast_vote(voter.id, choice)
        print(f"{voter.name} voted for {choice}")
        if winner is not None:
            print("Voting complete. Winner:", winner)

    print("Final snapshot:", gs.snapshot())


if __name__ == "__main__":
    main()
