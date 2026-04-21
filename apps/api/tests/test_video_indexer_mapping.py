"""Unit tests for Video Indexer insight mapping (no network)."""

from services.video_indexer_mapping import map_video_indexer_results_to_castweave_entities


def test_maps_nested_videos_insights_transcript():
    payload = {
        "state": "Processed",
        "videos": [
            {
                "insights": {
                    "sourceLanguage": "en-US",
                    "transcript": [
                        {
                            "text": "Hello world",
                            "speakerId": 2,
                            "instances": [
                                {"start": "0:00:00.000", "end": "0:00:01.500"},
                            ],
                        }
                    ],
                }
            }
        ],
    }
    lang, segs = map_video_indexer_results_to_castweave_entities(payload, "ep-1")
    assert lang == "en-US"
    assert len(segs) == 1
    assert segs[0].text == "Hello world"
    assert segs[0].speaker_label == "SPEAKER_VI_2"
    assert segs[0].start_time == 0.0
    assert abs(segs[0].end_time - 1.5) < 0.01


def test_maps_top_level_transcript():
    payload = {
        "state": "Processed",
        "sourceLanguage": "en-GB",
        "transcript": [
            {
                "text": "Line",
                "instances": [{"adjustedStart": "0:00:02", "adjustedEnd": "0:00:03"}],
            }
        ],
    }
    lang, segs = map_video_indexer_results_to_castweave_entities(payload, "ep-2")
    assert lang == "en-GB"
    assert len(segs) == 1
    assert segs[0].speaker_label.startswith("SPEAKER_VI_")
