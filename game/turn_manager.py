from typing import List, Optional


class TurnManager:
    """Gerencia a ordem de turnos entre jogadores.

    Mantém uma lista de `player_ids` e um índice atual. Fornece operações
    simples para avançar, obter jogador corrente e remover jogadores.
    """

    def __init__(self, player_ids: List[str] | None = None) -> None:
        self.player_ids: List[str] = list(player_ids) if player_ids else []
        self.index: int = 0

    def current(self) -> Optional[str]:
        if not self.player_ids:
            return None
        return self.player_ids[self.index]

    def advance(self) -> None:
        if not self.player_ids:
            return
        self.index = (self.index + 1) % len(self.player_ids)

    def remove(self, player_id: str) -> None:
        if player_id not in self.player_ids:
            return
        idx = self.player_ids.index(player_id)
        del self.player_ids[idx]
        if idx <= self.index and self.index > 0:
            self.index -= 1
        if self.index >= len(self.player_ids):
            self.index = 0

    def __repr__(self) -> str:  # pragma: no cover - trivial
        return f"TurnManager(current={self.current()}, players={self.player_ids})"
