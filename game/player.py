from typing import List

from .card import Card
from .deck import Deck


class Player:
    """Representa um jogador e sua mão de cartas.

    Implementação simples focada em clareza e testabilidade.
    """

    def __init__(self, player_id: str, name: str):
        self.id: str = player_id
        self.name: str = name
        self.hand: List[Card] = []
        self.score: int = 0

    def draw(self, deck: Deck, count: int = 1) -> None:
        """Puxa `count` cartas do `deck` para a mão do jogador."""
        cards = deck.draw(count)
        self.hand.extend(cards)

    def play(self, index: int) -> Card:
        """Joga a carta no índice `index` da mão e a remove.

        Lança IndexError se o índice for inválido.
        """
        card = self.hand.pop(index)
        return card

    def receive(self, cards: List[Card]) -> None:
        """Recebe uma lista de cartas (por exemplo, como recompensa)."""
        self.hand.extend(cards)

    def clear_hand(self) -> None:
        """Remove todas as cartas da mão."""
        self.hand.clear()

    def __repr__(self) -> str:
        return f"Player(id={self.id!r}, name={self.name!r}, hand={len(self.hand)} cards, score={self.score})"
