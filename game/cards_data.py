from typing import List, Tuple

from .card import Card, CardType
from .deck import Deck


def _sample_white_texts() -> List[str]:
    # Exemplos curtos/originais; substitua pelo seu conjunto de cartas.
    return [
        "Gabiru",
        "Cred molestando o Typero",
        "Tosknazi",
        "SSD do Rodrishow",
        "Almoço no ratão",
        "Virar bichona",
        "Desmaio na academia",
        "O Cred é bicha",
        "Samuel",
        "Gabriel T.I",

    ]


def _sample_black_texts() -> List[Tuple[str, int]]:
    # Tupla: (texto do prompt, número de respostas esperadas)
    return [
        ("Nada melhor do que ____.", 1),
        ("O FCG seria melhor se ____.", 1),
        ("Desmaiei na academia porque ____.", 1),
        ("O Futebol feminino é ____.", 1),
        ("O Kayke me chamou de preto porque ____.", 1),
        ("Virei momentos formidáveis do FCG porque ____.", 1),
        ("O BlackNinja me baniu porque ____.", 1),
        ("O AGM CM acha que ____ e todos deveriamos ____", 2),
    ]


def make_cah_like_decks(white_texts: List[str] | None = None, black_texts: List[Tuple[str, int]] | None = None) -> Tuple[Deck, Deck]:
    """Cria dois decks: (white_deck, black_deck).

    Se `white_texts` / `black_texts` não forem fornecidos, usa exemplos embutidos.
    Para usar cartas reais, passe uma lista com os textos desejados ou carregue de arquivos.
    """
    white_texts = white_texts if white_texts is not None else _sample_white_texts()
    black_texts = black_texts if black_texts is not None else _sample_black_texts()

    white_cards = [Card(i + 1, text, type=CardType.WHITE) for i, text in enumerate(white_texts)]
    black_cards = [Card(i + 1 + len(white_cards), text, type=CardType.BLACK, blanks=blanks) for i, (text, blanks) in enumerate(black_texts)]

    from .deck import Deck

    return Deck(white_cards), Deck(black_cards)


def load_from_files(white_path: str, black_path: str) -> Tuple[Deck, Deck]:
    """Carrega cartas a partir de dois arquivos de texto simples.

    - `white_path`: cada linha é uma carta branca (texto).
    - `black_path`: cada linha tem formato: <blanks>\t<prompt texto>
      ex: `1\tNada melhor do que {}.`
    Retorna `(white_deck, black_deck)`.
    """
    whites: List[str] = []
    blacks: List[Tuple[str, int]] = []
    with open(white_path, encoding="utf-8") as f:
        for line in f:
            t = line.strip()
            if t:
                whites.append(t)
    with open(black_path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            parts = s.split("\t", 1)
            if len(parts) == 2 and parts[0].isdigit():
                blanks = int(parts[0])
                text = parts[1]
            else:
                blanks = 1
                text = s
            blacks.append((text, blanks))
    return make_cah_like_decks(whites, blacks)
