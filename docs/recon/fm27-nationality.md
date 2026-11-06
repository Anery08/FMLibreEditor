# FM27: secondary nationalities and homegrown status

Notes behind editing a player's secondary nationalities and homegrown status. They were read
from the Mac Steam build, on the July 2026 save, against the game's own eligibility page
(**Personal › Nationality Information** and **Nation / Club Eligibility**), which the
maintainer shared for Kenan Yıldız, Jamal Musiala and Achraf Hakimi.

## The list of relations

A player's first nationality is his `nation` pointer. Everything else lives in one list: the
person's relations. The pointer at `+0x2C0` in the player object (macOS; in the person block,
`+0x300` on Windows by the usual 0x40) leads to a record that starts with a list
`(begin, end, capacity)` of 16-byte entries:

| Offset | Field |
| --- | --- |
| `+0x00` | pointer to the target: a nation, club, person or competition |
| `+0x08` | `u16`, a count some relations use |
| `+0x0A` | `u8`, the kind of target: 1 a club, 3 a person, 7 a competition, 8 a nation |
| `+0x0B` | `u8`, the kind of relation |
| `+0x0C` | `u8`, a value: a strength, or a homegrown rule |
| `+0x0D` | `u8`, a second level |
| `+0x0F` | always `0xFF` |

The relations that matter here:

| Relation | Target | Value | The game shows |
| --- | --- | --- | --- |
| 9 | nation | 100, then 80 | a secondary nationality |
| 70 | nation | the rule | Nation Eligibility: trained in the nation |
| 72 | club | the rule | Club Eligibility: trained at the club |
| 109 | nation | 0 (level 255; the count is the days it has left) | no work permit needed there |

The others include favoured clubs (3), disliked clubs (4), people (1, 2) and time spent in a
nation (124).

Relation 109 is how the game lets players of the European Union who were in the United Kingdom
before Brexit play there without a work permit. On the Game Pass save of July 2027, 72 players
had it for England and 2 for Scotland (Youri Tielemans, Timothy Castagne, Daniel Bachmann;
Kristoffer Ajer for Scotland), all with a count of 514 or 515, which goes down by one a day: it
read 835 and 836 on the save of September 2026. Players with an ordinary work permit, such as
Lisandro Martínez at Manchester United, have nothing of the kind in their list; the game names a
class `db::WORK_PERMIT_EXEMPTION_INFO`, of which the save had no object. The editor gives the
relation as the game does (value 0, level 255), with the count of the first player of the save
who has one, so that it ends with theirs, or ten years where no one has it.

Homegrown rules, by the game's code, as the eligibility page names them:

| Code | Rule |
| --- | --- |
| 1 | Homegrown 15-21 |
| 2 | Homegrown 0-21 |
| 5 | Homegrown 15-21 (excluding loans) |
| 10 | Homegrown 0-19 (1 year) |

Codes 3, 6, 7, 8, 11 and 12 occur too; their names are not known yet. The page's
**Nationality Eligibility** (for example "Italy, 4 Years In Nation") is not stored: the game
works it out.

Checked against the page:
- Yıldız: Germany (9), Germany and Italy (70, rule 1), FC Bayern and Juventus (72, rule 1),
  Juventus again with rule 5.
- Musiala: England and Nigeria (9), Germany (70, rule 1), England (70, rule 2), Chelsea (72,
  rules 2 and 10), FC Bayern (72, rule 1).
- Hakimi: Spain (9 and 70), Real Madrid (72).

## Room

Out of a sample of 3,636 lists, 94% were exactly as long as their capacity, and most held
1 to 8 entries. Their blocks are too small for the allocator's known size classes, so an entry
can seldom be added without allocating, which the editor never does. Changing or removing an
entry always works.

On the Game Pass save of July 2027 (10,655 players, `fmlibre-probe relation-kinds`): 8,372
players were trained at a club (relation 72), whose club the editor can point elsewhere, and 662
lists had room for one more entry. Of the 2,283 players trained at no club, 58 had room, 778
favoured or disliked a club (relations 3 and 4), 463 only favoured or disliked people (1 and 2),
and 984 had none of those.

None of the 10,655 lists had room past its length: after a load, every list is exactly as long
as what it holds (`fmlibre-probe relation-kinds`). Their buffers have no header: buffers of 16
to 160 bytes sit side by side, their own size apart, in blocks the game's allocator carves from
large regions; above that, in the size classes `layout.toml` names (`relation-blocks`). So no
other list has a bigger block to lend.

The editor grows a full list on Windows (`plan_relation_add`): it writes the entries and the new
one into memory of its own (`own_memory.rs`), with room for three more, and points the list's
begin, end and capacity at it. The old buffer stays as it was; the undo points the list back at
it. The game reads the list where it points, and keeps it in the save, which it writes from the
entries; on loading, it makes the list again in its own memory.

Relations to people are kept on both sides: Bukayo Saka's list holds Ezri Konsa (relation 1,
count 5, value 60), and Konsa's holds Saka with the same values. Such an entry points into the
person's object, not at its start: a player's at `+0x288` (plus his person block's shift:
`+0x380` for a player who is also staff), a member of staff's at `+0x100` (Saka's other one is
Mikel Arteta's).

## Checked in the game

With the probe holding the changes (`tie-set` and `tie-add` with `--hold`), the game's page
showed each at once:
- Yıldız's secondary nationality changed from Germany to England;
- Türkiye added to Musiala's, as a third secondary nationality;
- Hakimi's training changed from Spain, 15-21 to England, 0-21.

On the Windows Steam and Game Pass builds the record is at `+0x300` in the player, 0x40 further than on macOS
like the rest of the person, and the entries are laid out alike: Yıldız, Musiala and Hakimi read
exactly as above. A changed, an added and a removed entry were each restored with the probe and
undone in the app, on both builds.

Not yet checked: what a competition's homegrown rules make of a changed entry over a game day.

## Also seen

- `+0x2C8` points at the player's city of birth, whose nation is at `+0x20` (Regensburg,
  Germany for Yıldız).
- The international data at `+0x118` (`INTERNATIONAL_PLAYER_DATA`) lists the other national
  teams a player has played for: Victor Moses, England; Mateo Retegui, Argentina.
- FM27 keeps a person's appearance as the match engine's 3D face values
  (`MATCH_PERSON_APPEARANCE_INPUT`), not as a few fields.
