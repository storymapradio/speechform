"""Speech forms, semantic exemplars and persistent visual families."""
FORMS = {
'instruction': ('blocks', 'Follow these steps. First prepare the materials, then assemble the pieces. Turn the handle and check your work.'),
'lecture': ('blocks', 'Today I will explain the theory and the evidence. This concept follows from the research. Consider the historical development.'),
'lesson': ('blocks', 'Let us learn this together. Try an example, explain your answer, and practice the skill. What do you notice?'),
'dialogue': ('plates', 'You said something interesting. I agree with your point, but what do you think about my response? Let me answer your question.'),
'reflective monologue': ('seaweed', 'Looking back on my experience, I realize how I felt. I have come to understand myself differently. I remember what that meant to me.'),
'thinking aloud': ('scrolls', 'Let me think this through. Maybe I could try this approach. Wait, that does not work. What if I turn it around?'),
'stream of consciousness': ('seaweed', 'My mind wanders from one thought to another, coffee and the window and yesterday, and suddenly I remember the ocean.'),
'prosody': ('ribbons', 'Listen to the rhythm, the rise and fall of my voice, the pauses, the stress and emphasis, the melody of speaking.'),
'prose': ('scrolls', 'It was an ordinary afternoon. She walked through the town, watching people go about their lives. The afternoon passed quietly.'),
'song': ('ribbons', 'I sing a melody with a chorus and a verse. La la la, hold the note, repeat the refrain, sing along with me.'),
'lyrics': ('ribbons', 'In the chorus I sing I will always love you. These are the words to my song, a refrain that keeps coming back to you.'),
'poetry': ('ribbons', 'The moon is a silver wound upon the sea. Beneath the hush of stars, my heart unfolds in petals of memory.'),
'story': ('nodes', 'Once upon a time a traveler left home. Then something unexpected happened. After the adventure, she returned, changed forever.'),
'character development': ('nodes', 'She feared being abandoned, but her loyalty grew stronger. He wanted redemption. Her flaw became the source of her transformation.'),
'scenery': ('nodes', 'The forest stretched across the valley. Golden light filtered through the trees. Mountains rose above the distant river and mist.'),
'lore': ('nodes', 'In this ancient kingdom, the order of guardians keeps the secret history. Their customs and traditions shape the world and its people.'),
'myth': ('nodes', 'The gods descended from the heavens. An ancient hero stole fire from the divine, and the sacred tale explains the origin of the world.'),
'cosmology': ('nodes', 'The universe emerged from a primordial beginning. Galaxies and stars formed in the expanding cosmos. Space and time define existence.'),
'mystery': ('radar', 'A clue was missing. Who could have done it? The evidence points toward a hidden explanation. We must uncover the secret.'),
'argument': ('radar', 'The point of all of this is my central claim. The evidence supports this conclusion. Therefore we can bring the argument together.')
}
WORLDS=['blocks','seaweed','scrolls','nodes','radar','plates','ribbons']
COLORS=['#72f0aa','#a7b8ff','#ffe59b','#f5a8cd','#91e0f3','#eeb782','#d2f59b']
REHEARSAL=[
('A','First collect the seeds. Place each seed in a jar. Label the jar, water the seed, and watch the seed grow.'),
('A','Looking back, I remember how my grandmother taught me to listen. Her stories made me feel at home.'),
('A','Let me think this through. Maybe a school could begin with listening. What if every learner had a radio station?'),
('A','The forest stretched across the valley. Mist rose above the silver river, and the trees carried the scent of rain.'),
('A','Returning to my grandmother and her stories, I realize that listening to her was how I learned to belong.'),
('B','You said that listening matters. I agree, but I think asking questions matters too. What do you think?'),
('A','That is a good question. I agree with you. Let me respond: a question gives the other person somewhere to go.'),
('A','The clue was hidden in the empty jar. Why had the seeds disappeared? We needed to uncover the secret.'),
('A','The point of all of this is that learning begins when we listen to one another.'),
('A','The moon is a silver wound upon the sea. Beneath the hush of stars, my heart unfolds in petals of memory.')]
