// Healing an injured player and keeping a player from retiring, each undone.
import { findPlayer, retiringPlayers } from "../lib/witness.mjs";

export const name = "medical";
export const writes = true;

export async function run({ app, report, probe }) {
  const injured = await findPlayer(app, (details) => details.injuries.length > 0);
  if (!injured) {
    report.skip("heals an injured player", "no injured player among the best players of the best known clubs");
  } else {
    const { player } = injured;
    const count = player.injuries.length;
    const healed = await app.must("heal_player", { uid: player.uid });
    const after = await app.must("player_details", { uid: player.uid });
    report.check("heals an injured player", after.injuries.length === 0, `${player.name}: ${count} injuries`);
    const undone = await app.must("undo_change", { id: healed.id });
    const again = await app.must("player_details", { uid: player.uid });
    report.check("the undo injures him again", undone.undoneAt != null && again.injuries.length === count);
  }

  const players = retiringPlayers(probe);
  let retiring = null;
  for (const uid of players.slice(0, 20)) {
    const details = await app.must("player_details", { uid });
    if (details.retires != null) {
      retiring = details;
      break;
    }
  }
  if (!retiring) {
    report.skip("keeps a player from retiring", "the game plans no player's retirement on this save");
    return;
  }
  const kept = await app.must("keep_playing", { uid: retiring.uid });
  const after = await app.must("player_details", { uid: retiring.uid });
  report.check("keeps a player from retiring", after.retires == null, `${retiring.name} was to retire on ${JSON.stringify(retiring.retires)}`);
  const undone = await app.must("undo_change", { id: kept.id });
  const again = await app.must("player_details", { uid: retiring.uid });
  report.check("the undo plans his retirement again", undone.undoneAt != null && JSON.stringify(again.retires) === JSON.stringify(retiring.retires));
}
