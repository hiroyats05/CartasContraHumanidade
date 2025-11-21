from typing import List, Tuple

from .card import Card, CardType
from .deck import Deck


def _sample_white_texts() -> List[str]:
    # Exemplos curtos/originais; substitua pelo seu conjunto de cartas.
    return [
        "Um pato usando óculos de sol",
        "Dormir cedo e ainda acordar cansado",
        "Um sanduíche de geleia com pimenta",
        "Aquele momento embaraçoso no elevador",
        "Uma reunião que poderia ter sido um e-mail",
        "Gatos que julgam silenciosamente",
        "Fazer café e esquecer a xícara",
        "Uma viagem desastrosa mas engraçada",
        "O modem reiniciando sem motivo",
        "Uma playlist que só toca músicas ruins",
    ]


def _sample_black_texts() -> List[Tuple[str, int]]:
    # Tupla: (texto do prompt, número de respostas esperadas)
    return [
        ("Nada melhor do que {}.", 1),
        ("Em um mundo pós-apocalíptico, eu sempre levo {}.", 1),
        ("O que me deixa acordado à noite? {} e {}.", 2),
        ("Minha habilidade secreta é {}.", 1),
        ("No próximo comercial de TV, iremos mostrar {}.", 1),
        ("O FCG seria melhor se {}.", 1)
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
