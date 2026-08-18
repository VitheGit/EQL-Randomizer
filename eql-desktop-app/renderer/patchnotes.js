// Patch notes, newest first. Kept in its own file so entries can be
// added without touching renderer.js — just prepend to the array.
(function () {
  window.EQL_PATCH_NOTES = [
    {
      version: '1.1.13',
      notes: [
        'Fixed entries going missing when two players did something at the same moment — a death, level, or notable kill could be silently dropped from the Adventure Log and Leaderboard. Writes are now handled one at a time per group.',
        'Hardened account creation against two people claiming the same username simultaneously.',
        'Added a security policy to the app windows restricting what they\'re allowed to load.'
      ]
    },
    {
      version: '1.1.12',
      notes: [
        'Typing in chat is no longer interrupted when a message arrives — your cursor stays where you left it.',
        'Internal cleanup: removed leftover diagnostic logging, so the debug file stays much smaller.',
        'Fixed a file handle leak that could build up if the log file became unreadable.'
      ]
    },
    {
      version: '1.1.11',
      notes: [
        'Added this Patch Notes tab, so you can see what changed in each version.',
        'Fixed the Online list randomly showing nobody, and sometimes staying wrong until you restarted the app. It now refreshes on its own every 30 seconds.'
      ]
    },
    {
      version: '1.1.10',
      notes: [
        'Pressing Enter now logs you in (or creates your account) from any field on the login screen, instead of needing to click the button.'
      ]
    },
    {
      version: '1.1.9',
      notes: [
        'Added an Instructions button to the login screen, so you can read the instructions before making an account.'
      ]
    },
    {
      version: '1.1.8',
      notes: [
        'The Instructions tab is now filled in — covering setup, settings, randomizing, and what each tab does.',
        'The GitHub download link in the instructions opens in your browser.'
      ]
    },
    {
      version: '1.1.7',
      notes: [
        'Fixed Cazic-Thule not being recognized as a notable NPC — his in-game name has a dash in it.'
      ]
    },
    {
      version: '1.1.6',
      notes: [
        'Fixed group members not seeing each other\'s notable kills. When two people killed within the same moment, one of the entries could be lost before anyone else saw it.',
        'Notifications now come straight from the live connection instead of waiting on a re-read, so simultaneous deaths and level-ups no longer go missing either.'
      ]
    },
    {
      version: '1.1.5',
      notes: [
        'Added diagnostic logging to help track down notable kill notification problems.'
      ]
    },
    {
      version: '1.1.4',
      notes: [
        'Notable kills by multiple people are now combined into one notification — "Vithe, Kendie, and Khayotik have defeated Lord Nagafen on Difficulty 4!" — instead of separate popups.',
        'Everyone still gets individual credit in the Adventure Log and on the Leaderboard.'
      ]
    },
    {
      version: '1.1.3',
      notes: [
        'Chat name colors now show in the overlay too, automatically brightened so they stay readable against the dark background.'
      ]
    },
    {
      version: '1.1.2',
      notes: [
        'Fixed the app briefly freezing when changing your chat color, notification volume, or overlay opacity. Saving a setting no longer re-reads your entire log file.'
      ]
    },
    {
      version: '1.1.1',
      notes: [
        'Player names in notable kill notifications now appear in that player\'s chosen chat color.'
      ]
    },
    {
      version: '1.1.0',
      notes: [
        'Difficulty in notable kill notifications is now color-coded: 0 green, 1 yellow, 2 orange, 3 purple, 4 red.'
      ]
    }
  ];
})();
