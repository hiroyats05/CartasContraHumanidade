import random
from typing import Iterable, List

from .card import Card, CardType


class Deck:
    """Coleção de cartas com operações básicas (embaralhar, comprar, reset)."""

    def __init__(self, cards: Iterable[Card] | None = None):
        self._original: List[Card] = list(cards) if cards is not None else []
        self.cards: List[Card] = list(self._original)

    def shuffle(self) -> None:
        random.shuffle(self.cards)

    def draw(self, count: int = 1) -> List[Card]:
        drawn: List[Card] = []
        for _ in range(count):
            if not self.cards:
                break
            drawn.append(self.cards.pop(0))
        return drawn

    def draw_white(self, count: int = 1) -> List[Card]:
        """Draw up to `count` white cards from this deck (skips non-white)."""
        drawn: List[Card] = []
        remaining: List[Card] = []
        for c in self.cards:
            if len(drawn) >= count:
                remaining.append(c)
                continue
            if c.type == CardType.WHITE:
                drawn.append(c)
            else:
                remaining.append(c)
        self.cards = remaining + self.cards[len(drawn):]
        return drawn

    def draw_black(self) -> Card | None:
        """Draw the first black card from deck or None if none available."""
        for i, c in enumerate(self.cards):
            if c.type == CardType.BLACK:
                return self.cards.pop(i)
        return None

    def draw_random_black(self) -> Card | None:
        """Remove and return a random black card from the deck, or None if none available."""
        black_indices = [i for i, c in enumerate(self.cards) if c.type == CardType.BLACK]
        if not black_indices:
            return None
        idx = random.choice(black_indices)
        return self.cards.pop(idx)

    def add(self, card: Card) -> None:
        self.cards.append(card)

    def add_many(self, cards: Iterable[Card]) -> None:
        """Adiciona múltiplas cartas ao final do baralho."""
        self.cards.extend(cards)

    def reset(self) -> None:
        self.cards = list(self._original)

    def __len__(self) -> int:
        return len(self.cards)

    def is_empty(self) -> bool:
        return len(self.cards) == 0

    def __repr__(self) -> str:  # pragma: no cover - trivial
        return f"Deck({len(self.cards)} cards)"
