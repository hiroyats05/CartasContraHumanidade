"""Clean demo runner for the cardgame.

Run this as a replacement for a corrupted `run.py` file.
"""

from typing import Optional

from game.card import Card
from game.deck import Deck
from game.player import Player
from game.game_state import GameState
from game.cards_data import make_cah_like_decks


def _replicate_deck(deck: Deck, factor: int = 3) -> Deck:
    cards = []
    idx = 1
    for _ in range(factor):
        for c in deck.cards:
            cards.append(Card(idx, c.text, type=c.type, blanks=getattr(c, "blanks", 0)))
            idx += 1
    return Deck(cards)


def play_game(mode: str, demo_limit_for_infinite: int = 5, hand_size: int = 3) -> None:
    mode = mode.lower()
    if mode == "quick":
        max_rounds: Optional[int] = 10
    elif mode == "long":
        max_rounds = 30
    elif mode == "infinite":
        max_rounds = None
    else:
        raise ValueError("mode must be one of: quick, long, infinite")

    white, black = make_cah_like_decks()
    white = _replicate_deck(white, factor=5)
    black = _replicate_deck(black, factor=5)

    players = [Player("p1", "Alice"), Player("p2", "Bob"), Player("p3", "Carol")]
    combined = Deck(list(white.cards) + list(black.cards))

    gs = GameState(players, combined, hand_size=hand_size)
    gs.max_rounds = max_rounds
    gs.start()

    rounds = 0
    while not gs.is_finished():
        if mode == "infinite" and rounds >= demo_limit_for_infinite:
            print(f"Stopping infinite demo after {demo_limit_for_infinite} rounds")
            break

        b = black.draw(1)
        if not b:
            print("No black card available; ending")
            break
        prompt = b[0]
        print(f"Round {gs.current_round + 1} - Prompt: {prompt.text}")

        # submissions
        for p in players:
            try:
                gs.submit_card(p.id, 0)
            except Exception as e:
                print(f"submit failed for {p.id}: {e}")

        # simple voting strategy for demo
        for voter in players:
            candidates = [pid for pid in gs.voting.submissions.keys() if pid != voter.id]
            if candidates:
                gs.cast_vote(voter.id, candidates[0])

        # handle any runoffs automatically
        while gs.voting_open:
            for voter in players:
                candidates = [pid for pid in gs.voting.submissions.keys() if pid != voter.id]
                if candidates:
                    gs.cast_vote(voter.id, candidates[0])

        rounds += 1

    print("Final snapshot:", gs.snapshot())


if __name__ == "__main__":
    print("Running clean demo (quick)")
    play_game("quick")
