from typing import Dict, Optional, Iterable, List

from .card import Card


class VotingSession:
    """Gerencia submissões e votos para uma rodada de votação.

    - `submissions`: mapping de `player_id` -> `Card` (cartas submetidas)
    - `votes`: mapping de `voter_id` -> `voted_player_id`
    - `voters`: conjunto de `player_id` que estão autorizados a votar (normalmente todos os jogadores).

    Regras: não é permitido votar em si mesmo.
    """

    def __init__(self, submissions: Dict[str, Card], voters: Optional[Iterable[str]] = None):
        self.submissions: Dict[str, Card] = dict(submissions)
        self.votes: Dict[str, str] = {}
        if voters is None:
            self.voters = set(self.submissions.keys())
        else:
            self.voters = set(voters)

    def cast_vote(self, voter_id: str, voted_player_id: str) -> None:
        if voter_id not in self.voters:
            raise ValueError("Voter is not authorized to vote in this session")
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

    def leading_candidates(self) -> List[str]:
        """Retorna a lista de candidatos com maior número de votos (possível empate)."""
        counts = self.tally()
        if not counts:
            return []
        max_votes = max(counts.values())
        return [pid for pid, c in counts.items() if c == max_votes]

