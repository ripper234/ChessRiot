# ChessRiot Acceptance Test Flows

These tests define MVP behavior precisely enough to automate later. They intentionally exclude coach, animations, powers, matchmaking, real-time play, and skins.

## Onboarding

### Scenario: New user completes onboarding

Given a visitor is not signed in
When they sign in with Google
And they choose an unused username `omri`
Then their profile is created
And they land on the home screen
And refreshing the page keeps them signed in.

### Scenario: Username must be unique

Given user A already has username `omri`
When user B attempts to choose username `omri`
Then the app rejects the username
And user B remains in onboarding.

## Friends

### Scenario: Send and accept friend request by username

Given Ron has username `ron`
And Omri has username `omri`
When Ron searches for `omri`
And sends a friend request
Then Omri sees a pending friend request
When Omri accepts it
Then Ron and Omri appear in each other's friend lists.

### Scenario: Exact email lookup does not expose email lists

Given Omri's email is `omri@example.com`
When Ron searches for `omri@example.com`
Then Ron can find Omri
But Ron cannot browse partial email matches
And the friend list does not display Omri's email by default.

## Game invites

### Scenario: Start an async game with a friend

Given Ron and Omri are friends
When Ron starts a game with Omri
And chooses 3 days per move
Then a game invite is created
And Omri receives an in-app game invite notification.

### Scenario: Non-friends cannot start games

Given Ron and Dana are not friends
When Ron attempts to start a game with Dana
Then the request is rejected
And no game is created.

## Move validation

### Scenario: Legal first move is accepted

Given Ron and Omri have an active game
And it is White's turn
When White submits move `e2e4` with the current expected version
Then the move is accepted
And move 1 is stored in move history
And the board state changes to Black's turn
And Black receives an in-app notification and an email notification.

### Scenario: Illegal move is rejected

Given an active game is in the standard starting position
And it is White's turn
When White submits move `e2e5`
Then the move is rejected
And no move history row is created
And the game version does not change.

### Scenario: Wrong-turn move is rejected

Given Ron is White
And Omri is Black
And it is White's turn
When Omri submits move `e7e5`
Then the move is rejected
And the board state does not change.

### Scenario: Stale move is rejected

Given White and Black both loaded game version 4
And White legally moves, creating version 5
When White submits another move using expected version 4
Then the move is rejected as stale
And the client is told to reload the current game state.

## Persistence

### Scenario: Resume after refresh

Given Ron made legal move `e2e4`
When Omri closes and reopens the app
Then Omri sees the same game position
And the move history includes `e2e4`
And it is Omri's turn.

### Scenario: Completed game remains in history

Given a game ends by checkmate
When either player opens completed games
Then the completed game is listed
And the full move history is readable
And no further moves can be submitted.

## Authorization

### Scenario: Third party cannot read game

Given Ron and Omri have a game
And Dana is signed in
When Dana requests that game detail
Then access is denied.

### Scenario: Participant cannot mutate completed game

Given Ron and Omri have a completed game
When the side to move before completion submits a move
Then the move is rejected
And the completed result remains unchanged.
