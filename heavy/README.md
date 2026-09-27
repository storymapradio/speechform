# Speechform Heavy

In Speechform Heavy, Jev builds an image while you speak, over your own camera, and saves the sequence of images as it goes.

It uses the same classifier and the same ten growing images as [Speechform Light](../light/), and adds five things: the camera, images that Jev generates, a bank that reuses those images, a saved sequence, and the streak.

## What happens

- **First you see the camera.** As you speak, the feed dims and the layers move in over it: the growing image for the kind of speech, then the images Jev makes. Each of Jev's images slides in from the side you are moving toward.
- **The storyteller looms.** When the talk is narrative (story, myth, lore, character, cosmology, reading aloud), your silhouette looms large and translucent over the scene. It is cut out on the device by MediaPipe's selfie segmenter.
- **Moving plays, as it did with the EyeToy.** Where you move in front of the camera, sparks fly in the image's colour, and waving grows the image in front. Jev is told whether someone is in view, where their head is, and how and where they are moving.
- **The sequence.** The scene is saved at every change, and every ten seconds while you keep talking. The sequence screen shows the saved images streak by streak.
- **The streak.** Eight seconds of quiet breaks the streak. When you speak again, the scene builds on a saved image:
  - the one you tapped in the sequence (tap it again to return to the live camera);
  - otherwise, the one Jev picks;
  - without Jev, the one whose words are closest to what you are saying now.
- **Styles.** There are six: ink, stained glass, watercolour, neon, woodcut and cosmic. They shape the prompts Jev receives and the look of every layer.

## What an image may never be

Speechform Heavy makes no violent, gory or profane images:

- Bad words are masked in the transcript and in memory.
- Profane and violent words never reach a prompt.
- Every image request carries a negative prompt: violence, gore, blood, weapons, injury, death, nudity, profanity, text.
- The prompt itself asks for a scene that is calm, hopeful and suitable for all ages.

The lists are in `imagery/heavy.py` and `heavy/heavy.js`.

## The bank

Every image Jev makes is kept in `runtime/bank/`, with its style, image and keywords. Before Jev is asked, the bank is searched. If an image of the same kind and style shares at least half its keywords with the moment, it is reused at no cost. Jev is asked at most once every fifteen seconds. The bank therefore grows with new scenes only, and reuse becomes more common the longer Speechform is used.

## Jev: the token and the contract

Tap the key icon and enter Jev's endpoint and token (and, if images come from somewhere else, the image endpoint). They are saved on your Mac in `~/.config/speechform/settings.json`, which only you can read. The page never sees the token: the Speechform server calls Jev on your behalf.

Every call is a `POST` to the endpoint with `Authorization: Bearer <token>`, and a `task`:

| Task | Speechform sends | Jev answers |
| --- | --- | --- |
| `image` | `prompt`, `negative`, `style`, `size` `[768, 768]`, `seed`, `scene` (`kind`, `register`, `camera`) | `{"image": "data:image/png;base64,…"}` or `{"image": "https://…"}` |
| `choose` | `text` (what is being said now) and `candidates` (`id`, `kind`, `keywords`, `at`) | `{"id": "<one of the candidates>", "why": "…"}` |
| `direct` | the `/listen` payload (see [AGENTS.md](../AGENTS.md)) | a direction: `register`, `mix`, `warmth`, `tempo`, … |

To test without a token, run `python3 tests/mock_jev.py`, then set the endpoint to `http://127.0.0.1:9995`. The mock answers all three tasks in the same shape, drawing simple styled pictures.

## Run it

Start the Speechform server (`.worker/bin/python imagery/server.py`, or open Speechform.app), then visit `http://127.0.0.1:9990/heavy/`. Press ▶ to turn on the camera and listening. Hearing is on the device only, as in Speechform Light. The segmenter's code and model (a few MB) are downloaded once from jsDelivr and Google's model storage; camera frames never leave the device.
