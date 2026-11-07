//! Moving a member of staff to another club, and giving him another job at his club.
//!
//! A club keeps its staff in three department lists of pointers (see [`ClubLayout`]): the medical team, the coaches
//! and the scouts; a fitness coach may be in the first two. A member of staff's contract points at the team he works
//! for and at the club's senior team. A move takes him out of every department list of his old club that holds him,
//! puts him in the same departments of the new club, and points his contract at its senior team, dated from today. A
//! new job changes his contract's job code, and moves him between his club's departments as the job needs.
//!
//! A department list with no room for him in its block is grown into memory of the editor's own (see
//! `own_memory.rs`), where the editor can take memory (Windows); elsewhere the move is refused. Only staff whom neither
//! the club nor its teams point at directly are moved or given a new job: a team's manager, for one, is held by his
//! team, and is left to the game.
//!
//! [`ClubLayout`]: crate::ClubLayout

use fmlibre_mem::is_user_pointer;

use crate::clubs::ClubSummary;
use crate::edit::Kind;
use crate::own_memory::Growth;
use crate::profile::Layout;
use crate::session::Session;
use crate::staff::StaffSummary;
use crate::transfer::{MoveError, Patch, Patches, PointerList, removal_patches};

/// A department of a club's staff.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Department {
    Medical,
    Coaching,
    Scouting,
}

impl Department {
    pub fn name(self) -> &'static str {
        match self {
            Department::Medical => "medical",
            Department::Coaching => "coaching",
            Department::Scouting => "scouting",
        }
    }

    /// Where the club keeps the list of this department.
    fn offset(self, layout: &Layout) -> u64 {
        match self {
            Department::Medical => layout.club.medical_staff,
            Department::Coaching => layout.club.coaching_staff,
            Department::Scouting => layout.club.scouting_staff,
        }
    }
}

const DEPARTMENTS: [Department; 3] = [Department::Medical, Department::Coaching, Department::Scouting];

/// The jobs the editor gives and takes away, by contract code (see [`crate::job_name`]), with the department each
/// belongs to. A manager, the board, the directors and jobs the editor cannot name are left as they are.
pub const STAFF_JOBS: [(u8, Department); 14] = [
    (2, Department::Coaching),  // Coach
    (20, Department::Coaching), // Assistant Coach
    (22, Department::Coaching), // Set Piece Coach
    (26, Department::Coaching), // Fitness Coach, some of whom the medical team lists too
    (34, Department::Coaching), // Goalkeeping Coach
    (60, Department::Coaching), // Performance Analyst
    (64, Department::Coaching), // Head of Youth Development
    (12, Department::Medical),  // Physio
    (40, Department::Medical),  // Head of Sports Science
    (48, Department::Medical),  // Sports Scientist
    (50, Department::Medical),  // Head Physio
    (14, Department::Scouting), // Scout
    (44, Department::Scouting), // Chief Scout
    (58, Department::Scouting), // Recruitment Analyst
];

/// The department of a job the editor gives and takes away.
pub fn department_of(job: u8) -> Option<Department> {
    STAFF_JOBS.iter().find(|&&(code, _)| code == job).map(|&(_, department)| department)
}

/// How many bytes of a club, and of each of its teams, are looked through for a pointer to a member of staff.
const CLUB_BYTES: usize = 0x170;
const TEAM_BYTES: usize = 0x800;

/// A move of a member of staff, or a new job, worked out from the game as it is now and ready to be written.
#[derive(Debug, Clone)]
pub struct StaffPlan {
    pub member: u32,
    pub from_club: u32,
    /// The club he moves to; his own for a new job.
    pub to_club: u32,
    /// The job he has, and the one he will have (the same for a move).
    pub job: (u8, u8),
    /// Whether a department list he joins is grown into memory of the editor's own, its block having no room.
    pub grows: bool,
    patches: Vec<Patch>,
    grow: Vec<Growth>,
}

/// A move or a new job that was written: what undoing it takes.
#[derive(Debug, Clone)]
pub struct StaffChange {
    pub member: u32,
    pub from_club: u32,
    pub to_club: u32,
    pub job: (u8, u8),
    /// Whether a department list was grown.
    pub grew: bool,
    patches: Vec<Patch>,
}

/// What ties a member of staff to his club, checked.
struct Holder {
    object: u64,
    contract: u64,
    /// The contract's bytes, as read.
    record: Vec<u8>,
    club: u64,
    club_uid: u32,
    job: u8,
    /// Each department list of the club that holds him: the department, the list, where in it he is, what it holds.
    lists: Vec<(Department, PointerList, usize, Vec<u64>)>,
}

impl Session {
    /// Works out moving `member` to `club`, in the departments he works in, on his contract dated from today. Nothing
    /// is written.
    pub fn plan_staff_move(&self, member: &StaffSummary, club: &ClubSummary) -> Result<StaffPlan, MoveError> {
        let (process, layout) = (&self.process, &self.layout);
        let holder = self.staff_holder(member)?;
        if process.read_u32(club.address + layout.club.uid)? != club.uid {
            return Err(MoveError::NotAClub { uid: club.uid });
        }
        if club.address == holder.club {
            return Err(MoveError::SameClub);
        }
        let women = |address: u64| process.read_bytes(address + layout.club.women, 1).map(|b| b[0]);
        if women(holder.club)? != women(club.address)? {
            return Err(MoveError::MenAndWomen);
        }
        // The new club's senior team must point back at it.
        let senior = match PointerList::read(process, club.address + layout.club.teams)? {
            Some(teams) if teams.len() > 0 => process.read_u64(teams.begin_address())?,
            _ => 0,
        };
        if !is_user_pointer(senior) || process.read_u64(senior + layout.team.club)? != club.address {
            return Err(MoveError::NotAClub { uid: club.uid });
        }

        let (mut patches, mut grow) = (Patches::default(), Vec::new());
        for (department, list, index, elements) in &holder.lists {
            let joining = self.department_list(club.address, *department)?;
            if joining.1.contains(&holder.object) {
                return Err(MoveError::NotInDepartment);
            }
            self.join_department(&joining, holder.object, *department, &mut patches, &mut grow)?;
            removal_patches(list, *index, elements, &mut patches);
        }
        self.staff_contract_patches(&holder, Some(senior), holder.job, &mut patches);
        Ok(StaffPlan {
            member: member.uid,
            from_club: holder.club_uid,
            to_club: club.uid,
            job: (holder.job, holder.job),
            grows: !grow.is_empty(),
            patches: patches.0,
            grow,
        })
    }

    /// Works out giving `member` the job `job` at his club: he leaves the departments the job is not in, and joins
    /// the one it is in. Nothing is written.
    pub fn plan_staff_job(&self, member: &StaffSummary, job: u8) -> Result<StaffPlan, MoveError> {
        let holder = self.staff_holder(member)?;
        department_of(holder.job).ok_or(MoveError::UnusualJob { job: holder.job })?;
        let department = department_of(job).ok_or(MoveError::UnusualJob { job })?;

        let (mut patches, mut grow) = (Patches::default(), Vec::new());
        if job != holder.job {
            for (from, list, index, elements) in &holder.lists {
                if *from != department {
                    removal_patches(list, *index, elements, &mut patches);
                }
            }
            if !holder.lists.iter().any(|(from, ..)| *from == department) {
                let joining = self.department_list(holder.club, department)?;
                self.join_department(&joining, holder.object, department, &mut patches, &mut grow)?;
            }
            self.staff_contract_patches(&holder, None, job, &mut patches);
        }
        Ok(StaffPlan {
            member: member.uid,
            from_club: holder.club_uid,
            to_club: holder.club_uid,
            job: (holder.job, job),
            grows: !grow.is_empty(),
            patches: patches.0,
            grow,
        })
    }

    /// Writes a plan, each write over the bytes it expects, after checking them all. A department list to grow gets
    /// its buffer first, and is pointed at it before the rest is written.
    pub fn apply_staff_plan(&self, plan: &StaffPlan) -> Result<StaffChange, MoveError> {
        let mut patches = plan.grow.iter().map(|growth| self.grown_list(growth)).collect::<Result<Vec<_>, _>>()?;
        patches.extend(plan.patches.iter().cloned());
        self.apply_patches(&patches)?;
        let StaffPlan { member, from_club, to_club, job, grows, .. } = *plan;
        Ok(StaffChange { member, from_club, to_club, job, grew: grows, patches })
    }

    /// Puts the member of staff back as he was, provided memory still holds everything the change wrote.
    pub fn undo_staff_change(&self, done: &StaffChange) -> Result<(), MoveError> {
        self.undo_patches(&done.patches)
    }

    /// Checks what ties `member` to his club, and finds every department list of it that holds him.
    fn staff_holder(&self, member: &StaffSummary) -> Result<Holder, MoveError> {
        let (process, layout) = (&self.process, &self.layout);
        let (s, c) = (&layout.staff, &layout.contract);
        if member.is_human || member.shift != 0 {
            return Err(MoveError::You);
        }
        let object = member.address;
        if process.read_u32(object + s.uid)? != member.uid {
            return Err(MoveError::Moved { uid: member.uid });
        }
        let contract = process.read_u64(object + s.contract)?;
        if !is_user_pointer(contract) {
            return Err(MoveError::Unemployed);
        }
        let record = process.read_bytes(contract, c.end() as usize)?;
        let word =
            |offset: u64| u64::from_le_bytes(record[offset as usize..offset as usize + 8].try_into().expect("8 bytes"));
        let job = record[c.job as usize];
        let (team, senior) = (word(c.team), word(c.senior_team));
        if word(c.owner) != object + s.identity() || !is_user_pointer(team) || !is_user_pointer(senior) {
            return Err(MoveError::UnusualContract);
        }
        // A player, or a player-coach (a coaching job's code plus one), is moved as a player or not at all.
        if job == 1 || (job > 1 && job % 2 == 1) {
            return Err(MoveError::PlayerCoach);
        }
        let club = process.read_u64(senior + layout.team.club)?;
        if !is_user_pointer(club) || process.read_u64(team + layout.team.club)? != club {
            return Err(MoveError::UnusualContract);
        }
        let club_uid = process.read_u32(club + layout.club.uid)?;

        let mut lists = Vec::new();
        for department in DEPARTMENTS {
            let Ok((list, elements)) = self.department_list(club, department) else {
                continue;
            };
            let held: Vec<usize> = elements.iter().enumerate().filter(|&(_, &e)| e == object).map(|(i, _)| i).collect();
            match held[..] {
                [] => {}
                [index] => lists.push((department, list, index, elements)),
                _ => return Err(MoveError::NotInDepartment),
            }
        }
        if lists.is_empty() {
            // A manager or a director is in none of them: his job, not the lists, is why he stays.
            return Err(match department_of(job) {
                Some(_) => MoveError::NotInDepartment,
                None => MoveError::UnusualJob { job },
            });
        }
        self.check_unheld(club, object, object + s.identity(), object + s.person_block)?;
        Ok(Holder { object, contract, record, club, club_uid, job, lists })
    }

    /// The club's list of `department`, and what it holds; an empty one where the club has no one in it yet.
    fn department_list(&self, club: u64, department: Department) -> Result<(PointerList, Vec<u64>), MoveError> {
        let list = PointerList::read_or_empty(&self.process, club + department.offset(&self.layout))?
            .ok_or(MoveError::DepartmentFull { department: department.name(), staff: 0 })?;
        let elements = list.elements(&self.process)?;
        Ok((list, elements))
    }

    /// Puts `object` into the list of `department` (as read, with what it holds): after them where its block has room,
    /// or else in the list grown (see the module's notes).
    fn join_department(
        &self,
        (list, elements): &(PointerList, Vec<u64>),
        object: u64,
        department: Department,
        patches: &mut Patches,
        grow: &mut Vec<Growth>,
    ) -> Result<(), MoveError> {
        if list.len() < list.room(&self.process, &self.layout.heap)? {
            return self.append_patches(list, object, patches);
        }
        let mut bytes: Vec<u8> = elements.iter().flat_map(|element| element.to_le_bytes()).collect();
        bytes.extend(object.to_le_bytes());
        let full = MoveError::DepartmentFull { department: department.name(), staff: list.len() };
        grow.push(self.growth(list.header(), list.words(), bytes, 8).ok_or(full)?);
        Ok(())
    }

    /// Fails when the club or one of its teams points at the member of staff (his object, identity or person block)
    /// itself, rather than through a department list: such a role is the game's to move.
    fn check_unheld(&self, club: u64, object: u64, identity: u64, person: u64) -> Result<(), MoveError> {
        let process = &self.process;
        let mut places = vec![(club, CLUB_BYTES)];
        if let Some(teams) = PointerList::read(process, club + self.layout.club.teams)? {
            places
                .extend(teams.elements(process)?.into_iter().filter(|&t| is_user_pointer(t)).map(|t| (t, TEAM_BYTES)));
        }
        for (address, len) in places {
            let bytes = process.read_bytes(address, len)?;
            let held = bytes
                .as_chunks::<8>()
                .0
                .iter()
                .map(|w| u64::from_le_bytes(*w))
                .any(|w| w == object || w == identity || w == person);
            if held {
                return Err(MoveError::StaffRole);
            }
        }
        Ok(())
    }

    /// The contract of the member of staff `holder` describes: his new club's senior team from today, for a move;
    /// the job `job`.
    fn staff_contract_patches(&self, holder: &Holder, senior: Option<u64>, job: u8, patches: &mut Patches) {
        let c = &self.layout.contract;
        let Holder { contract, ref record, .. } = *holder;
        let at = |offset: u64, len: usize| &record[offset as usize..offset as usize + len];
        if let Some(senior) = senior {
            for offset in [c.team, c.senior_team] {
                patches.push(contract + offset, at(offset, 8), senior.to_le_bytes());
            }
            if let Some(today) = self.game_date() {
                for offset in [c.signed, c.joined] {
                    // A date the game has not set stays unset.
                    if Kind::Date.decode(at(offset, 4)) != 0 {
                        patches.push(
                            contract + offset,
                            at(offset, 4),
                            Kind::Date.encode(today.to_number(), at(offset, 4)),
                        );
                    }
                }
            }
        }
        patches.push(contract + c.job, at(c.job, 1), [job]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_job_has_one_department_and_none_is_a_player_coach() {
        for (i, &(code, _)) in STAFF_JOBS.iter().enumerate() {
            assert!(code > 1 && code % 2 == 0, "{code}");
            assert!(crate::job_name(code).is_some(), "{code}");
            assert!(!STAFF_JOBS[i + 1..].iter().any(|&(other, _)| other == code), "{code}");
        }
        assert_eq!(department_of(26), Some(Department::Coaching));
        assert_eq!(department_of(16), None, "a manager is left as he is");
    }
}
