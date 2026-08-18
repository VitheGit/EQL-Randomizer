// Instructions content, transcribed from the Word document Brad wrote.
// Kept in its own file so the prose can be edited without touching
// renderer.js. Rendered by renderInstructionsView().
(function () {
  window.EQL_INSTRUCTIONS = {
    intro: 'Welcome to the EQ Legends Randomizer and Hardcore app! This app is meant to let you randomize characters and play a "hardcore" mode with your friends. How you do that, and the rules you create, are up to you! The app will give you a Race and 3 classes at random. The idea is to create that character on the server of your choosing and see how far you can get. If you die, delete and remake!',

    sections: [
      {
        title: 'Getting Started',
        steps: [
          { text: 'Download the app from the GitHub page.', link: 'https://github.com/VitheGit/EQL-Randomizer' },
          { text: 'Grab the latest release on the right-hand side of the page.' },
          { text: 'Install it. Note: you might need to "Unblock" or allow the install — this is because the installer isn\'t signed.' },
          { text: 'Create an account if you don\'t have one, using the "Create Account" button.' },
          { text: 'Account creation is simple — no email needed. Just choose a Username and Password, then click "Create Account".' }
        ]
      },
      {
        title: 'Set Up Your Settings',
        note: 'Before randomizing a character, visit the Settings tab.',
        steps: [
          { label: 'EQ Legends Log File', text: 'Point the app at the log file you want to use. You CAN leave this blank — if you do, your character will be handled MANUALLY instead of the app reading your log file for automatic updates.' },
          { label: 'In-Game Character Name', text: 'Make sure this matches your in-game character name exactly.' },
          { label: 'Group Name', text: 'This can be anything you like — a guild name, or something you share with friends. The Group Name determines your Adventure Log, Leaderboard, and notifications. Everyone you want to play Hardcore with should use the same Group Name.' },
          { text: 'Click "Save Settings".' }
        ]
      },
      {
        title: 'Other Settings',
        note: 'Scroll down on the Settings tab to adjust these as you see fit.',
        steps: [
          { label: 'When you click the "X" button', text: 'By default the app minimizes to the system tray so it keeps monitoring your log file. Change this if you\'d rather it close completely.' },
          { label: 'Notifications / Notification Sounds', text: 'Turn notifications and their sounds on or off. There\'s also a volume slider.' },
          { label: 'Notification Position', text: 'Where the notification box appears on your main monitor. Default is Top-Middle.' }
        ]
      },
      {
        title: 'Randomizing a Character',
        note: 'Go to the Randomizer tab and click "Randomize!" to get a random character to create. These options change how you play:',
        steps: [
          { label: 'Hardcore', text: 'You\'re meant to delete your character if you die.' },
          { label: 'SSF', text: 'Solo Self-Found — no outside help, grouping, or trading with other players.' },
          { label: 'Random Leveling Path', text: 'Generates a leveling path to follow from level 10+. Stay in the zones it gives you and only use items from those zones. An added layer of difficulty!' },
          { label: 'D4 Only', text: 'You\'ll only play on Difficulty 4. With this on, the app reminds you to switch to D4 whenever you zone into a new area.' }
        ],
        footer: 'Once you randomize, any options you picked appear as icons in the top-right of your character box.'
      },
      {
        title: 'The Other Tabs',
        steps: [
          { label: 'Leaderboard', text: 'Shows all hardcore characters, sorted by level and how long it took to reach it. Filters at the top let you narrow by class, status, SSF, Leveling Path, or D4.' },
          { label: 'Adventure Log', text: 'A log of everything happening in your group — characters randomized, deaths, dings, and more.' },
          { label: 'Admin', text: 'Clear your Leaderboard and/or Adventure Log if you want a fresh start. You\'ll need to type your Group Name to confirm. Note: anyone in your group can do this, so be careful who you share your group name with. Clearing either one leaves an entry in the Adventure Log showing who did it and when.' }
        ]
      }
    ],

    closing: [
      'I hope you enjoy the app. Feel free to use it however you and your group like — come up with your own rules, you don\'t have to follow my suggestions! If you have ideas or things you\'d like to see implemented, please let me know.',
      'I\'m new to development, so there very well could be bugs and issues! Please let me know if you find any. My Discord name is "Vithe".',
      'Thank you so much for trying out the app!'
    ],

    signoff: '— Vithe of Rivervale'
  };
})();
