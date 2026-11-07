// Moving a member of staff to a club whose department is full, as most are once a save is loaded: the app grows the
// department's list, the probe reads him at the new club, and the undo puts him back. A new job in another department
// of his club, the same way.
import { humanClubs, topClubs } from "../lib/witness.mjs";

export const name = "staff";
export const writes = true;

/** Coaching jobs the editor moves (see STAFF_JOBS in staff_move.rs), and a scout's, for a new job. */
const COACHING = [2, 20, 22, 26, 34, 60, 64];
const SCOUT = 14;

/** The club the probe reads the member of staff `id` at, by name. */
function probedClub(probe, id) {
  const line = probe.run(["staff", id]).split(/\r?\n/).find((l) => l.trimStart().startsWith(String(id)));
  return line?.replace(/\s+/g, " ").trim() ?? "";
}

export async function run({ app, report, probe }) {
  const human = await humanClubs(app);
  const clubs = await topClubs(app, 10);
  const staff = (await app.must("search_staff", { query: "", limit: 200 })).rows;
  const coach = staff.find((m) => !m.isHuman && m.clubUid != null && !human.includes(m.clubUid) && COACHING.includes(m.job));
  if (!coach) {
    report.skip("moves a coach to a club with a full department", "no coach at a club no human manages among the best staff");
    return;
  }
  const club = clubs.find((c) => c.uid !== coach.clubUid);
  report.note(`witness: ${coach.name} (${coach.uid}), ${coach.club} → ${club.name}`);
  const before = probedClub(probe, coach.uid);
  report.check("the probe reads him at his club", before.includes(coach.club.slice(0, 20)), before);

  const plan = await app.invoke("plan_staff_move", { uid: coach.uid, club: club.uid });
  report.check("the move is offered, the department full or not", plan.ok, plan.ok ? `${plan.value.from.name} → ${plan.value.to.name}` : plan.error.code);
  if (!plan.ok) return;
  const moved = await app.must("move_staff", { uid: coach.uid, club: club.uid });
  const after = probedClub(probe, coach.uid);
  report.check("moves him, as the probe reads it", after.includes(club.name.slice(0, 20)), after);
  await app.must("undo_change", { id: moved.id });
  const back = probedClub(probe, coach.uid);
  report.check("the undo puts him back", back === before, back);

  // A new job in another department of his club: a scout's.
  const job = await app.invoke("change_staff_job", { uid: coach.uid, job: SCOUT });
  report.check("gives him a scout's job at his club", job.ok, job.ok ? "" : job.error.code);
  if (job.ok) {
    report.check("as the probe reads it", /Scout/.test(probedClub(probe, coach.uid)), probedClub(probe, coach.uid));
    await app.must("undo_change", { id: job.value.id });
    report.check("and the undo gives him his job back", probedClub(probe, coach.uid) === before, probedClub(probe, coach.uid));
  }
}
