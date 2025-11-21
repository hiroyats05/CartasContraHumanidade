from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict


class CardType(Enum):
    WHITE = "white"  # respostas
    BLACK = "black"  # prompts/perguntas


@dataclass
class Card:
    """Modelo genérico de carta.

    Para cartas pretas (prompts) o campo `blanks` indica quantos espaços
    (respostas) a carta espera (ex.: 1 ou 2).
    """

    id: int
    text: str
    type: CardType = CardType.WHITE
    blanks: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def is_black(self) -> bool:
        return self.type == CardType.BLACK

    def is_white(self) -> bool:
        return self.type == CardType.WHITE

    def __repr__(self) -> str:  # pragma: no cover - trivial
        return f"Card(id={self.id}, type={self.type.value}, blanks={self.blanks}, text={self.text!r})"
