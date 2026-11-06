# FM27: contract clauses, squad statuses and kinds of contract

What a player's contract holds besides the fields in `[contract]` (`profiles/fm27/layout.toml`): the kinds of its
clauses and bonuses, its squad status and its kind, by the codes the game keeps them as. Read on the Windows Steam build
26340721 (27.0.0) against the game's contract screen in English, on two saves: one of 35,867 players and one of
125,533 with many nations (15,155 of them women). From the findings in #81. The editor names every code below; the
names stay the game's English ones in the English dictionary.

## Clauses and bonuses

The contract's list at `+0x68` holds 8-byte entries: a `u32` amount in pounds (`0xFFFFFFFF` for none), a `u16`
condition (`0xFFFF` for none) and a `u16` kind.

| Kind | In game | Amount | Condition | Seen on |
| --- | --- | --- | --- | --- |
| 0 | Minimum Fee Release Clause | the fee | expiry | Ebiowei, Jeong |
| 1 | Relegation Release Clause (inactive unless the club is relegated) | the fee | expiry | Schlicke |
| 2 | Non Promotion Release Clause | the fee | expiry | Ebiowei |
| 3 | Yearly Wage Rise | | % | Schlicke |
| 4 | Promotion Wage Rise | | % | Ebiowei |
| 5 | Relegation Wage Drop | | % | Schlicke |
| 6 | release clause for a staff role (seen in the German UI only) | | | Zapata, ter Stegen |
| 8 | Sell On Fee Percentage | | % | Jeong |
| 9 | Sell On Fee Profit Percentage | the profit it starts at | % | Sylla: 7 % of the profit over £2,147,579 |
| 10 | Seasonal Landmark Goal Bonus | the bonus | league goals in the season | Orsolini: £250K after 25 |
| 11 | One-Year Extension After League Games (Final Season) | | league games | Pelivan: 10 |
| 12 | Match Highest Earner Clause | | | Lavezzi, J. Cooper |
| 13 | Wage After Reaching Club League Games | the new wage a week | league games | Christensen: £6.16M a year after 30 |
| 14 | Top Division Promotion Wage Rise | | % | Inui, Barba (9,844 on the large save) |
| 15 | Top Division Relegation Wage Drop | | % | Schlotterbeck |
| 16 | Minimum Fee Release Clause (Foreign Clubs) | the fee | expiry | De Arrascaeta |
| 17 | Minimum Fee Release Clause (Domestic Clubs in Higher Division) | the fee | expiry | Schlicke |
| 18 | Minimum Fee Release Clause (Domestic Clubs) | the fee | expiry | De Arrascaeta |
| 19 | a wage after a number of international matches (not seen on either save) | | matches | |
| 20 | Percentage of Wages paid by Sponsor | | % | Ronaldo, Watkins, Bounou |
| 21 | Percentage of Gate Receipts paid to Player | | % | Gelos |
| 22 | Optional Contract Extension By Club | | years | |
| 23 | Waive Club Compensation For Managerial Role | | | Kofler |
| 25 | One-Year Extension After League Games (Promoted Final Season) | | league games | Maxime Lopez |
| 26 | One-Year Extension After League Games (Avoid Relegation Final Season) | | league games | Winks |
| 27 | Minimum Fee Release Clause (Clubs in UEFA Champions League) | the fee | expiry | Schlotterbeck, Prestianni |
| 28 | MLS Guaranteed Contract Clause | | | Messi |
| 29 | Contract Extension After Promotion | | years | Barba |
| 30 | Injury Release Clause | | | Christensen |
| 31 | Minimum Fee Release Clause (Clubs in a Continental Competition) | the fee | expiry | Musa |
| 32 | Appearance Fee (under Bonuses) | the fee | | |
| 33 | Goal Bonus | the bonus | | |
| 34 | Clean Sheet Bonus | the bonus | | |
| 37 | International Cap Bonus | the bonus | | De Arrascaeta |
| 38 | Unused Substitute Fee | the fee | | |
| 39 | Assist Bonus | the bonus | | |
| 40 | Seasonal Landmark Assist Bonus | the bonus | league assists in the season | Orsolini: £86K after 20 |
| 41 | Seasonal Landmark Combined Goal and Assist Bonus | the bonus | league goals and assists | Kane: £215K after 40 |
| 55 | Active Relegation Release Clause | the fee | expiry | Jeong |

- **A release clause's expiry** is its condition: the days from the contract's start (`signed`, `+0x44`) until it
  expires. One without a condition never expires. Ben Schlicke's 17, signed on 3 July 2027 with 791, and Eli Junior
  Kroupi's 27, signed on 15 January 2027 with 960, both show "Expires on 1.9.2029"; Schlicke's 1 had one too. It is
  taken to hold for every release clause above. The app shows the day; it does not change a release clause's
  condition.
- **27** is shown as inactive while the player's own club plays in the Champions League.
- **A release clause of 0** (kind 0, 62 times on the large save) is shown by the game as a release clause of 0.
  Whether the game takes a bid of nothing is not known.
- **Not shown in the game:** 54 (no values; 31 times: Füllkrug, J. Hofmann), 58 (a condition from 1,262 to 1,433;
  7 times: Demirbay, Zainutdinov, whose screen says "No Addons") and 63 (no values; 14 times: Sabitzer, Szczęsny).
  The app lists them as "Not shown in the game".
- **Bonuses for winning a competition** ("Winning the First Division", "Winning the UEFA Champions League") are not
  in this list. They are the contract's list at `+0x80` (32-byte entries: the competition's UID at `+0x14`, the amount
  at `+0x18`), which the app does not show yet. "Remaining Loyalty Bonus" is not in it either.

## Squad statuses (`+0x54`)

| Code | In game | Seen on |
| --- | --- | --- |
| 1 | Star Player | Mbappé, Messi |
| 2 | Important Player | Rodri, Orsolini |
| 3 | Regular Starter | Vinícius Júnior |
| 4 | Squad Player | Frenkie de Jong, Christensen |
| 5 | Impact Sub | Cristiano Ronaldo |
| 7 | Fringe Player | Richarlison, Balde, Galeno |
| 9 | Emergency Backup | Okubo |
| 10 | Breakthrough Prospect | Rico Lewis |
| 11 | Future Prospect (the FM21 manual's "Hot Prospect") | Pol Fortuny |
| 13 | Youngster | Marli Salmon, Mathis Albert |
| 14 | B Team Regular | Iván Villar |
| 15 | First-Choice Goalkeeper | Joan García |
| 16 | Cup Goalkeeper | Areola |
| 17 | Domestic Cup Goalkeeper | Neuer |
| 20 | Backup | Szczęsny |
| 21 | Emergency Backup (goalkeepers) | Bürki |
| 22 | Surplus to Requirements | Josh Sargent |

6, 8, 12, 18 and 19 were not seen on either save; the game's manual also names a "Continental Cup Goalkeeper", which
may be one of them. 15, 16, 17, 20 and 21 are only goalkeepers'. A free agent has no contract. For a player on loan
the contract screen shows the clubs instead of the status. The app names every code above; its edit menu still offers
1 to 5 only.

## Kind of contract (`+0xC3`)

| Code | In game | Seen on |
| --- | --- | --- |
| 0 | Part-Time Contract | Lucas Beltrán, Dominik Pelivan |
| 1 | Full-Time Contract | |
| 2 | Amateur Contract | |
| 3 | Youth Contract | |
| 4 | Non-Contract | Yussuf Poulsen, Shayon Harrison |
| 10 | Senior Minimum Salary Contract (MLS) | Heorhiy Berezovskyi |
| 11 | Senior Contract (MLS) | Mark McKenzie |

On a save of 31 May 2028 with 33,670 players: 23,506 full-time, 4,472 youth, 1,820 part-time, 1,043 amateur,
932 non-contract, 6 of 10 and 1 of 11. A non-contract player's wage and expiry show as n/a, and his value at
`player +0x234` reads 0. The MLS's "Designated Player Contract" is not this byte: Messi, Bürki, Sargent and Latte Lath
read 1, as a full-time contract.

## On the Mac

Read with the probe (`histogram 0xC3 --contract`, `histogram 0x54 --contract`, `clauses`) on the Mac Steam build
26340721 (Apple silicon), on the Arsenal save of 33,616 contracts. The contract is laid out as on Windows, so
`layout-macos.toml` names the kind of contract at `+0xC3` too.

- **Kinds of contract:** 21,759 full-time (Mbappé, Haaland), 8,110 youth (16 years old on average), 1,812 part-time
  (Lucas Beltrán, as on Windows), 1,176 amateur, 758 non-contract and one 11 (Mark McKenzie, as on Windows).
- **Squad statuses:** exactly the codes above, none of 6, 8, 12, 18 or 19. 15, 16, 17, 20 and 21 are goalkeepers'
  (Joan García 15; Robert Sánchez 16; Mamardashvili and Lunin 17; ter Stegen and Onana 20; Rulli 21); Balde is 7;
  Zambo Anguissa, Çalhanoğlu and Akanji are 22.
- **Clauses:** the kinds above, and two more. 19 is on 111 contracts (an amount like a weekly wage, from 116 to
  239,865: Soulé, Lukeba, Alex Scott), and 56 on two, with an amount (Charles Vernam 588,000, Mahamadou Dembélé
  116,930), not named yet. Moussa Sylla's 9 holds 2,147,579 and 7, as on Windows; Kane's 41 holds 214,757.
- **Release clauses that follow each other:** Nico Schlotterbeck (contract signed on 10 April 2026) has three
  release clauses for foreign clubs: 51,541,912 with 797 days, 51,541,912 with 1,162 and 42,951,596 with 1,527. The
  conditions are 365 days apart and, as expiry dates, fall on 15 June 2028, 2029 and 2030. How the game weighs
  several release clauses of one kind is not known. No player of the human club has a release clause with a
  condition, and a player the club has not scouted shows no contract details, so the expiry was not seen on a game
  screen on the Mac.
- **In the game** (Turkish UI): Cristhian Mosquera's 13 (78,000 a week after 40 league games) and Harry Kane's 41
  (214,757 after 40 league goals and assists in the season) show as the app words them.
