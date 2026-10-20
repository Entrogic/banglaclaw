"""Port of packages/agent/src/language.ts, so replies are classified exactly as the agent classifies input."""

from __future__ import annotations

import re
from typing import Literal

Language = Literal["bn", "bn-en", "en"]

_BENGALI = re.compile(r"[ঀ-৿]")
_WORDLIKE = re.compile(r"[^\W_]", re.UNICODE)
_WORD = re.compile(r"[a-z]+")

# Keep in sync with BANGLISH_WORDS in packages/agent/src/language.ts.
BANGLISH_WORDS = frozenset(
    """
    ami amar amake amra tumi tomar tomake apni apnar apnake se tar ora
    ki kii keno kemon kivabe kibhabe kothay kokhon koto koyta kon ke
    acho achen achi ache achhe chilo thakbe nai nei na hae ha hya
    bhalo valo kharap khub onek ektu shob sob aro
    kore koro koren korbo korte korchi korsi korlam hobe hoy hoyeche hoise hocche
    bolo bolen bolte jani janina jano dao den dite nao nibo jabo jao jai ashbo ashen dekho dekhi
    ekhon aj aaj ajke kal kalke porshu baje bajche shomoy somoy din raat
    bhai vai apu dada didi mama khala
    kotha taka dam jonno theke diye sathe shathe moto kintu tobe tahole jodi ar o
    dhonnobad accha achha thik thikache shuvo shubho salam assalamualaikum
    """.split()
)


def detect_language(text: str) -> Language:
    """bn: at least half the words in Bengali script; bn-en: Banglish or mixed; en: everything else."""
    tokens = [t for t in text.split() if _WORDLIKE.search(t)]
    if not tokens:
        return "en"

    bengali = sum(1 for t in tokens if _BENGALI.search(t))
    if bengali / len(tokens) >= 0.5:
        return "bn"
    if bengali > 0:
        return "bn-en"

    words = _WORD.findall(text.lower())
    if not words:
        return "en"
    hits = sum(1 for w in words if w in BANGLISH_WORDS)
    if hits >= 2 or (hits == 1 and len(words) <= 3 and any(len(w) >= 3 and w in BANGLISH_WORDS for w in words)):
        return "bn-en"
    return "en"


def acceptable_reply_languages(input_language: Language) -> frozenset[Language]:
    """What the system prompt asks for (packages/agent/src/prompts.ts): answer in the user's language.

    Banglish questions may also be answered in Bengali script.
    """
    if input_language == "bn-en":
        return frozenset({"bn-en", "bn"})
    return frozenset({input_language})
