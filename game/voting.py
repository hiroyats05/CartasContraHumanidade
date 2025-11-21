from typing import Dict, Optional

from .card import Card


class VotingSession:
    """Gerencia submissões e votos para uma rodada de votação.

    - `submissions`: mapping de `player_id` -> `Card` (cartas submetidas)
    - `votes`: mapping de `voter_id` -> `voted_player_id`

    Regras simples: não é permitido votar em si mesmo.
    """

    def __init__(self, submissions: Dict[str, Card]):
        self.submissions: Dict[str, Card] = dict(submissions)
        self.votes: Dict[str, str] = {}

    def cast_vote(self, voter_id: str, voted_player_id: str) -> None:
        if voter_id not in self.submissions:
            raise ValueError("Voter is not part of this voting session")
        if voted_player_id not in self.submissions:
            raise ValueError("Voted player is not part of this voting session")
        if voter_id == voted_player_id:
            raise ValueError("Cannot vote for yourself")
        self.votes[voter_id] = voted_player_id

    def tally(self) -> Dict[str, int]:
        counts: Dict[str, int] = {pid: 0 for pid in self.submissions.keys()}
        for voted in self.votes.values():
            counts[voted] = counts.get(voted, 0) + 1
        return counts

    def winner(self) -> Optional[str]:
        counts = self.tally()
        if not counts:
            return None
        # escolhe com mais votos; em caso de empate, usa ordenação estável (menor player id)
        max_votes = max(counts.values())
        candidates = [pid for pid, c in counts.items() if c == max_votes]
        return sorted(candidates)[0]
