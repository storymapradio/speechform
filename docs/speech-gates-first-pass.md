# Speech Gates

A local first pass at a speech-driven TouchDesigner instrument, built for Aaron on September 8, 2026.

Open **Speech Gates.toe** in TouchDesigner, then **Speech Gates Intake.app**. The intake panel's **Open visuals** button opens the output. The project is already built and installed in this directory.

## Use it

1. Enable **Start microphone**, or choose an audio recording and press **Transcribe**. Apple’s macOS 26 SpeechAnalyzer performs transcription on this Mac. Microphone audio arrives in six-second batches, followed by transcription and semantic analysis. Stopping capture flushes the final phrase.
2. Speak normally. The local MiniLM sentence embedding model compares each finalized phrase with speech-form exemplars and existing ideas. Similarity scores are visible. A two-phrase hold, or a sufficiently clear score margin, stabilizes gate changes.
3. Select **Speaker A** or **Speaker B** at turn boundaries for dialogue. The plates slowly approach each speaker's share of dialogue words with a 25-second response constant.
4. Use **Visual world** to explore any scene with the same accumulated data. **Follow speech** restores automatic routing. **Form** overrides typed input classification; audio stays automatic.
5. **Example speech** feeds ten labeled sample utterances over roughly one minute. This is visibly marked Rehearsal. **Stop example** ends it.
6. **Export** saves a chronological transcript and the regrouped idea scrolls to `sessions/`. Every session also has a JSON archive. **New session** starts another archive; previous sessions stay on disk.

The TouchDesigner component also exposes the same controls through its Intake, Worlds, and Session custom parameter pages. The native panel is optional.

## Gates and visual architecture

| Speech form | Visual world | First-pass behavior |
| --- | --- | --- |
| Instruction, lecture, lesson | Word blocks | Repeated words accumulate boxes. Exact counts accompany stacks, with eight boxes visible per stack and twenty words visible. |
| Reflective monologue, stream of consciousness | Idea seaweed | Stable ideas sprout from a parabolic base. Returning to an idea extends the same plant. Each form uses a different curl pattern. |
| Thinking aloud, prose | Four scrolls | The four most recently active ideas appear as separate transcripts. Earlier ideas remain in session storage and return to view when resumed. |
| Story | Nodes | Ideas follow a winding narrative path. |
| Character development | Nodes | Ideas gather into a connected constellation. |
| Scenery | Nodes | Ideas form a landscape arrangement. |
| Lore, myth | Nodes | Ideas form expanding hexagonal structures. |
| Cosmology | Nodes | Ideas orbit the shared center. |
| Mystery, argument/conclusion | Radar | Semantic distance from the opening thought controls radius. “The point of all of this is” and related conclusion cues bring the signal to the blinking center. |
| Dialogue | Tectonic plates | Explicitly labeled speakers' dialogue word counts control slow overlap. |
| Prosody, song, lyrics, poetry | Ribbons | Form-specific wave patterns and live microphone energy shape ribbons. |

Every speech-form change triggers an expanding omega portal. Ideas and word counts survive changes of world. Both light and dark output palettes are implemented.

## What the first pass measures

This is a working semantic prototype. MiniLM is an embedding model, with explicit exemplars and a handful of discourse cues, rather than a trained classifier for these twenty categories. The displayed values are similarity scores, not calibrated confidence probabilities. Forms can overlap and classification can be wrong. Automatic recognition of singing, pitch, metre, speaker identity, emotional dominance, narrative roles, and factual cosmology is outside this pass. Ribbon movement uses audio energy plus designed oscillation. Plate overlap measures dialogue word share.

Idea matching uses semantic similarity and keyword overlap with persistent centroids. Regrouping moves whole finalized phrases into their assigned idea; the speaker's text is preserved verbatim. The original chronological transcript is retained. It does not rewrite speech into polished prose. New tangents inside a single finalized phrase can remain grouped together.

The state can retain more ideas than fit onscreen. The seaweed view shows the latest fourteen plants, the node view the latest twenty-two nodes, and the scroll view four recent ideas. Plant height is capped to fit the viewport; word counts continue to accumulate. The artwork is a 1280 × 720 CPU-rendered prototype uploaded into native Script TOPs, leaving room for later GPU geometry and larger output.

## Network

`/project1/speech_gates` contains:

- `microphone`: native Audio Device In CHOP, 44.1 kHz mono.
- `frame_clock`: capture, atomic state ingestion, and gradual control updates.
- `state`: the complete current JSON state.
- `utterances`: rows with id, speaker, form, topic, and original text.
- `ideas`: stable id, title, word count, and return count.
- `controls`: `audio_rms`, `world`, `idea_count`, `radar_distance`, `speaker_balance`, and `point_found` channels.
- Seven separate Script TOPs, one for each visual world.
- `world_switch` → `final` → `out1`.

Connect native TouchDesigner effects, geometry, feedback, or output systems to these channels and tables. Transcription and embedding inference run in a separate process, so they do not execute on the render thread. Runtime messages are atomic files in `runtime/`; no speech is sent to a cloud AI service. The developer automation bridge binds to localhost.

## Source and local dependencies

- `Transcribe.swift` uses Apple's SpeechAnalyzer and SpeechTranscriber, including AssetInventory setup.
- `ControlPanel.swift` builds the native SwiftUI intake application.
- `engine.py` implements semantic classification, deduplication, topic identity, and reassignment.
- `worker.py` handles input, local models, recovery, and session exports.
- `render.py` draws all seven scenes.
- `td_runtime.py` connects native operators to the worker.
- `build_td.py` generates the TouchDesigner network.

This installation uses a Python 3.12 worker environment in `.worker/`, a Pillow dependency for TouchDesigner's Python 3.11 in `.venv/`, and MiniLM weights in `models/`. Model and dependency downloads are complete. `build_local.sh` rebuilds the native executables. Absolute paths currently target this installation directory. The downloaded Whisper fallback is unused; transcription uses Apple exclusively.

## Verification

- Native Apple transcription passed on a generated eight-second recording.
- That recording passed through TouchDesigner intake, transcription, semantic classification, persistent state, and the visible output.
- Native microphone capture produced nonzero audio samples and queued six-second WAV input for Apple transcription.
- Five engine tests cover repeated word counts, duplicate suppression, idea return, speaker/conclusion controls, reassignment with text preservation, and form override.
- All seven visual worlds were rendered in both themes and visually inspected.
- The native panel's rehearsal, world selection, and light palette controls were exercised against the live TouchDesigner project.
- Session recovery preserved stable idea IDs after the worker restarted.

## Next frontier

1. Calibrate the overlapping speech forms with a set of your own recordings and preferred labels; add editable idea names and a visible correction control.
2. Replace the first-pass drawings with native GPU geometry, flowing scroll surfaces, and a spatial omega passage.
3. Add streaming Apple transcription, diarization, pitch and rhythm features, and richer narrative relationships while preserving the same state contract.

Primary implementation references: [Apple SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer), [Apple AssetInventory](https://developer.apple.com/documentation/speech/assetinventory), and [TouchDesigner Audio Device In CHOP](https://docs.derivative.ca/Audio_Device_In_CHOP).
