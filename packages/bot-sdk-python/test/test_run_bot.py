"""Tests for thunderdome_bot_sdk.run_bot — mirrors packages/bot-sdk/test/run-bot.test.ts's
coverage of the same contract in TypeScript. Uses only the standard library (unittest, io):
this package has zero runtime dependencies, and its test suite shouldn't need any either.

Run with: python3 -m unittest discover -s packages/bot-sdk-python/test -v
"""

import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from thunderdome_bot_sdk import run_bot  # noqa: E402


def sent_messages(output):
    output.seek(0)
    return [json.loads(line) for line in output.read().splitlines() if line]


class RunBotTests(unittest.TestCase):
    def test_replies_to_init_with_ready(self):
        input_stream = io.StringIO(
            json.dumps(
                {'type': 'init', 'matchId': 'm1', 'payload': {'rngSeed': 'abc', 'config': {}}}
            )
            + '\n'
        )
        output = io.StringIO()

        run_bot(lambda observation: {'choice': 'rock'}, input_stream=input_stream, output_stream=output)

        [message] = sent_messages(output)
        self.assertIsInstance(message.pop('sentAt'), str)
        self.assertEqual(
            message,
            {
                'protocolVersion': '1.0',
                'type': 'ready',
                'matchId': 'm1',
                'seq': 0,
                'payload': {'protocolVersion': '1.0'},
            },
        )

    def test_calls_on_init_with_the_full_init_payload_before_replying(self):
        input_stream = io.StringIO(
            json.dumps(
                {
                    'type': 'init',
                    'matchId': 'm1',
                    'payload': {'rngSeed': 'abc', 'config': {'bestOf': 3}},
                }
            )
            + '\n'
        )
        output = io.StringIO()
        received = []

        run_bot(
            lambda observation: {'choice': 'rock'},
            on_init=received.append,
            input_stream=input_stream,
            output_stream=output,
        )

        self.assertEqual(received, [{'rngSeed': 'abc', 'config': {'bestOf': 3}}])

    def test_calls_decide_action_and_sends_an_action_when_awaiting_action_is_true(self):
        input_stream = io.StringIO(
            json.dumps(
                {
                    'type': 'observation',
                    'matchId': 'm1',
                    'roundId': 2,
                    'payload': {'state': {'round': 2}, 'awaitingAction': True},
                }
            )
            + '\n'
        )
        output = io.StringIO()
        received = []

        def decide_action(observation):
            received.append(observation)
            return {'choice': 'paper'}

        run_bot(decide_action, input_stream=input_stream, output_stream=output)

        self.assertEqual(received, [{'round': 2}])
        [message] = sent_messages(output)
        self.assertIsInstance(message.pop('sentAt'), str)
        self.assertEqual(
            message,
            {
                'protocolVersion': '1.0',
                'type': 'action',
                'matchId': 'm1',
                'roundId': 2,
                'seq': 0,
                'payload': {'action': {'choice': 'paper'}},
            },
        )

    def test_does_not_call_decide_action_when_awaiting_action_is_false(self):
        input_stream = io.StringIO(
            json.dumps(
                {
                    'type': 'observation',
                    'matchId': 'm1',
                    'roundId': 1,
                    'payload': {'state': {}, 'awaitingAction': False},
                }
            )
            + '\n'
        )
        output = io.StringIO()
        calls = []

        run_bot(
            lambda observation: calls.append(observation) or {'choice': 'paper'},
            input_stream=input_stream,
            output_stream=output,
        )

        self.assertEqual(calls, [])
        self.assertEqual(sent_messages(output), [])

    def test_calls_exit_fn_with_0_on_match_end(self):
        input_stream = io.StringIO(json.dumps({'type': 'match-end', 'matchId': 'm1'}) + '\n')
        output = io.StringIO()
        exit_calls = []

        run_bot(
            lambda observation: {'choice': 'rock'},
            exit_fn=exit_calls.append,
            input_stream=input_stream,
            output_stream=output,
        )

        self.assertEqual(exit_calls, [0])

    def test_ignores_malformed_json_lines_without_raising(self):
        input_stream = io.StringIO('not json\n')
        output = io.StringIO()

        run_bot(lambda observation: {'choice': 'rock'}, input_stream=input_stream, output_stream=output)

        self.assertEqual(sent_messages(output), [])

    def test_ignores_messages_missing_type_or_match_id(self):
        input_stream = io.StringIO(
            json.dumps({'matchId': 'm1'}) + '\n' + json.dumps({'type': 'observation'}) + '\n'
        )
        output = io.StringIO()
        calls = []

        run_bot(
            lambda observation: calls.append(observation) or {'choice': 'rock'},
            input_stream=input_stream,
            output_stream=output,
        )

        self.assertEqual(calls, [])
        self.assertEqual(sent_messages(output), [])

    def test_seq_increases_across_multiple_outgoing_messages(self):
        input_stream = io.StringIO(
            json.dumps({'type': 'init', 'matchId': 'm1', 'payload': {'rngSeed': 'x', 'config': {}}})
            + '\n'
            + json.dumps(
                {
                    'type': 'observation',
                    'matchId': 'm1',
                    'roundId': 1,
                    'payload': {'state': {}, 'awaitingAction': True},
                }
            )
            + '\n'
        )
        output = io.StringIO()

        run_bot(lambda observation: {'choice': 'rock'}, input_stream=input_stream, output_stream=output)

        ready, action = sent_messages(output)
        self.assertEqual(ready['seq'], 0)
        self.assertEqual(action['seq'], 1)


if __name__ == '__main__':
    unittest.main()
