#!/usr/bin/env python3
"""News Reaction Stock Market — reacts only to the round's public news: buys a fixed quantity on
clearly positive headlines, sells on clearly negative ones, holds on NO_NEWS. Unlike the other
reference bots for this game, this one never looks at price history at all — only the event type.

See games/stock-market/src/types.ts for the exact Observation/Action shapes.

All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting on
"match-end") lives in thunderdome_bot_sdk's run_bot() — see docs/guides/bot-author-guide.md §4.
This file only needs to decide each turn's action — no randomness, so no PRNG/on_init needed at
all.
"""
from thunderdome_bot_sdk import run_bot

MAX_TRADE_QUANTITY = 10

POSITIVE_EVENTS = {'POSITIVE_NEWS', 'ANALYST_UPGRADE', 'PRODUCT_SUCCESS', 'EARNINGS_BEAT'}
NEGATIVE_EVENTS = {'NEGATIVE_NEWS', 'ANALYST_DOWNGRADE', 'PRODUCT_FAILURE', 'EARNINGS_MISS'}


def decide_action(observation):
    event_type = observation['event']['type']
    portfolio = observation['portfolio']
    price = observation['market']['price']

    if event_type in POSITIVE_EVENTS:
        max_affordable = int((portfolio['cash'] * 0.99) / price)
        quantity = min(max_affordable, MAX_TRADE_QUANTITY)
        if quantity >= 1:
            return {'action': 'BUY', 'quantity': quantity}
    elif event_type in NEGATIVE_EVENTS:
        quantity = min(portfolio['shares'], MAX_TRADE_QUANTITY)
        if quantity >= 1:
            return {'action': 'SELL', 'quantity': quantity}

    return {'action': 'HOLD'}


run_bot(decide_action)
