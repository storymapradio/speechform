"""The kinds of speech Speechform listens for.

Each kind has several short examples on unrelated topics, so that what the examples share
is the FORM of the speech (commands, questions, memory, narration, rhythm) and not its
subject. A passage is compared with every example of every kind, and each kind is
scored by how close its nearest examples come.

Each kind also names the image it grows (see imagery/growers.py).
"""
KINDS = {
 'instruction': ('stack', [
  "First, unplug the machine. Then remove the back panel and set the screws aside.",
  "Mix the flour and salt, add the water slowly, and knead the dough for ten minutes.",
  "Hold the camera steady, press the shutter halfway to focus, then take the picture.",
  "Before you plant the seedlings, water the soil and make a hole twice as wide as the roots.",
  "Turn left at the second light, park behind the library, and take the stairs to the third floor.",
  "Listen carefully, adjust the level until the needle stays below red, and record a short test.",
 ]),
 'lecture': ('stack', [
  "Today I will explain how trade routes shaped the growth of medieval cities.",
  "The research shows that attention declines after about twenty minutes, and the evidence is consistent across studies.",
  "Historians have long debated the causes of the collapse, and three main theories have emerged.",
  "This concept, first proposed in the nineteenth century, remains central to modern economics.",
  "In this session we will examine the structure of the cell and the function of each part.",
  "The data suggest a clear pattern, which I will summarize before turning to the implications.",
 ]),
 'lesson': ('stack', [
  "Let's try this together. What do you notice about the pattern on the board?",
  "Good. Now you do the next one, and explain your answer to the person beside you.",
  "Can anyone tell me what this word means? Take a guess, there are no wrong answers.",
  "Open your books to page twelve and practise the first three exercises.",
  "Watch how I do the first one, then try the second yourselves.",
  "Who can show the class another way to solve it? Great, come up to the board.",
 ]),
 'dialogue': ('tide', [
  "You said you'd call. I know, I'm sorry, what happened? Nothing, I just waited.",
  "I agree with you, but what do you think about asking them first?",
  "Where were you? At the shop. Why? Because I needed milk. Oh, okay.",
  "Let me answer your question: yes, I'll come, if you drive.",
  "Did you mean that? Of course I did. Then why did you laugh? Because you looked so serious.",
  "Tell me more about that. Well, it started when you left. When I left? Yes, you.",
 ]),
 'reflective monologue': ('kelp', [
  "Looking back, I realize how much that summer changed me.",
  "I remember the way my father tied his boots, and I understand now what he was teaching me.",
  "I have come to see my years in that city as a kind of apprenticeship.",
  "When I think about her, I feel grateful, and a little ashamed of how little I said.",
  "It took me a long time to understand why I left, and longer to forgive myself.",
  "I used to believe success meant being busy. I see it differently now.",
 ]),
 'thinking aloud': ('kelp', [
  "Let me think. If I leave at five, maybe I can make it. Wait, no, the bridge is closed.",
  "Hmm, what if we turn it the other way? Actually, that might work.",
  "So the total is wrong. Maybe I added it twice. Let me check that again.",
  "Okay, so first I need the key, then, hold on, where did I put the key?",
  "I'm not sure. It could be the battery, or maybe the cable. Let me try the cable.",
  "What would happen if we doubled it? No, that's too much. Half, then.",
 ]),
 'stream of consciousness': ('kelp', [
  "The rain on the window and my coffee going cold and the song from the car, the one from that summer, and my sister's red coat.",
  "Tired and the lights are too bright and I keep thinking of the sea and a dog barking somewhere and the smell of oranges.",
  "And then the bus, and the woman with the umbrella, and what did he mean, and the clock is wrong again, it's always wrong.",
  "Blue, the sky is so blue, and my hands are cold, and I forgot the letter, and the birds on the wire like notes.",
 ]),
 'reading aloud': ('path', [
  "Chapter two. The town lay in a hollow between two hills, and its people had lived there for as long as anyone could remember.",
  "It was the custom of the house that no guest should leave without a meal, a custom observed even in the leanest years.",
  "The author, writing in the winter of that year, describes a society on the edge of great change.",
  "Mr. Hale had not always been a patient man, though the years had softened him considerably.",
  "The following pages record, as faithfully as memory allows, the events of that autumn.",
  "In the opening section the writer argues that every garden is a small act of hope.",
 ]),
 'song': ('waves', [
  "Sing it with me now, la la la, hold the note and bring it round again.",
  "Oh oh oh, here comes the chorus, everybody clap your hands.",
  "Na na na, one more time, louder now, sing it out.",
  "Hey, hey, come on and sing, the whole room, together now.",
 ]),
 'lyrics': ('waves', [
  "And I'll keep coming back to you, back to you, every time the night is blue.",
  "You're the one, you're the one, since the day that we begun.",
  "Hold me close and don't let go, baby, you should know, you should know.",
  "Every road leads home to you, every road, every road leads home.",
 ]),
 'poetry': ('bloom', [
  "The moon is a silver wound upon the sea.",
  "What the orchard keeps, it keeps in frost, a white ledger of the dead year.",
  "My grief is a stone the river turns and turns.",
  "Light, that slow bird, settles on the wall and folds its wings.",
  "Under the hush of snow the fields are sleeping letters.",
  "I carry your name like a lantern through the rooms of the year.",
 ]),
 'story': ('path', [
  "Once upon a time a boy found a door at the bottom of the well.",
  "She packed her bag, said goodbye to no one, and caught the last train north.",
  "When they reached the village, the bells were ringing, and nobody would say why.",
  "Then the old woman opened the box, and a light came out of it.",
  "After three days of walking, the travelers came to a river with no bridge.",
  "He woke to find the house empty and a note on the table.",
 ]),
 'character development': ('path', [
  "He was proud, and his pride kept him alone, until the winter he needed help.",
  "She feared being ordinary, and that fear made her reckless.",
  "Over the years his anger softened into something like kindness.",
  "Her loyalty was her strength, and in the end it was also her undoing.",
  "At first he wanted only money; later he wanted to be forgiven.",
 ]),
 'scenery': ('land', [
  "The valley opened below us, green and wide, with a river winding through it.",
  "Mist lay on the lake, and the far hills were blue with distance.",
  "Pines lined the ridge, and the late light turned the rocks to copper.",
  "The street was quiet, wet with rain, the shop windows glowing yellow.",
  "Dunes rolled to the horizon under a white, enormous sky.",
 ]),
 'lore': ('hive', [
  "In the old kingdom, the guild of weavers kept the records of every family.",
  "By custom, the eldest daughter guards the well, as her mothers did before her.",
  "The order of the lamp was founded after the first war, and its oath is still spoken.",
  "Each clan traces its line to one of the seven founders of the city.",
 ]),
 'myth': ('hive', [
  "In the beginning, the sky and the sea were one, until the gods divided them.",
  "The trickster stole fire from the sun and hid it in the mountain.",
  "The first people were shaped from clay by the river goddess.",
  "And that is why the moon follows the sun across the sky, forever searching.",
 ]),
 'cosmology': ('orrery', [
  "The universe began in a hot dense state and has been expanding ever since.",
  "Galaxies gather along filaments, with vast voids between them.",
  "Time itself may have begun with the first instant of the cosmos.",
  "Stars forge heavier elements, and their deaths scatter them through space.",
 ]),
 'mystery': ('rings', [
  "The door was locked from the inside. So who took the letter?",
  "Every clue pointed to the gardener, but the gardener had been away all week.",
  "Something was missing from the room, and I couldn't say what.",
  "Why had the clock stopped at seven? And who wound it back?",
 ]),
 'argument': ('rings', [
  "The point of all of this is that we should fund the libraries.",
  "The evidence is clear, and therefore the policy must change.",
  "My claim is simple: the costs outweigh the benefits, and here is why.",
  "Critics say it is too expensive, but that objection does not hold.",
 ]),
}

# What each kind sounds like in its structure, whatever it is about. Each signal is
# measured on the passage as a rate from 0 to 1; the weights say how much it counts.
SIGNALS = {
 'instruction': {'imperative': .10, 'you': .05, 'sequence': .06},
 'lesson': {'question': .05, 'you': .04, 'imperative': .03, 'class': .06},
 'lecture': {'academic': .08},
 'argument': {'academic': .04, 'therefore': .07},
 'dialogue': {'question': .05, 'you': .03, 'turns': .06},
 'thinking aloud': {'hedge': .09, 'i': .02, 'question': .02},
 'reflective monologue': {'i': .05, 'past': .03, 'realize': .07},
 'stream of consciousness': {'runon': .08},
 'story': {'past': .05, 'third': .04},
 'reading aloud': {'past': .03, 'third': .03, 'formal': .06},
 'character development': {'third': .03},
 'song': {'refrain': .09},
 'lyrics': {'refrain': .06},
}

# Kept for the first-pass visual worlds and the rehearsal, which still read catalog.FORMS.
WORLD_OF = {k: v[0] for k, v in KINDS.items()}
