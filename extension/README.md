This VS Code extension adds filesystem-based proximity voice chat to VS Code.

You [may have already heard of proximity chat from video games.](https://en.wikipedia.org/wiki/Proximity_chat) In games, people standing right next to you are loud, but as they move further away from you, they become quieter and quieter, until you can't hear them at all. This extension brings that concept to VS Code. If you're in the same file as another person, you'll hear them at 100% volume. As you move further away from them in the file structure (same folder but different file, one level up/down, etc.), you'll hear them more quietly, until you can't hear them at all.

We use Git remote URL in order to connect you with people who are in the same project as you. Thus, this extension will only work when you have a file open that is part of a Git repository with a remote set.

After installing, start Proximity Chat from the Command Pallete (Shift + Ctrl/Cmd + P), using the command `Proximity Chat: Start`.

Additional features:
- You can see everyone connected to Proximity Chat in the `Chat Participants` box at the bottom of the file explorer (left sidebar). More bars in the audio symbol means that the person is closer to you, and thus you'll be able to hear them more clearly.
- Set your username using the `Proximity Chat: Set Username...` command. Otherwise, you'll show up as "Anonymous".
- You can mute or deafen yourself using the status bar buttons at the bottom left of your screen, or using commands.