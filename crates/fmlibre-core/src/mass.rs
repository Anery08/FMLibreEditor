//! Changing fields of many players, staff or clubs at once. A plan is worked out from
//! the values the game holds now, shown as a preview, and then written change by
//! change, each only while the game still holds the value it was planned from.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::coded::Coded;
use crate::edit::{EditError, Field, Kind, Target};
use crate::session::Session;

/// What to do with a field's value. Values are as stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Operation {
    /// Set it to `value`.
    Set { value: i64 },
    /// Add `amount`, which may be negative; the result stays within the field's range.
    Add { amount: i64 },
    /// Multiply it by `percent` / 100, rounded; the result stays within the field's range.
    Scale { percent: i64 },
}

impl Operation {
    /// Whether the operation suits `field`: dates can only be set, and a value set must
    /// be one the field takes.
    pub fn check(self, field: &Field) -> Result<(), EditError> {
        match self {
            _ if !field.mass => {
                Err(EditError::Unsupported { field: field.key.clone(), reason: "it is changed one person at a time" })
            }
            Operation::Set { value } if !field.takes(value) => {
                Err(EditError::OutOfRange { field: field.key.clone(), value, min: field.min, max: field.max })
            }
            Operation::Add { .. } | Operation::Scale { .. } if field.kind == Kind::Date => {
                Err(EditError::Unsupported { field: field.key.clone(), reason: "a date can only be set" })
            }
            _ => Ok(()),
        }
    }

    /// The value the operation turns `old` into.
    pub fn apply(self, field: &Field, old: i64) -> i64 {
        match self {
            Operation::Set { value } => value,
            Operation::Add { amount } => old.saturating_add(amount).clamp(field.min, field.max),
            Operation::Scale { percent } => {
                let scaled = (old as f64 * percent as f64 / 100.0).round() as i64;
                scaled.clamp(field.min, field.max)
            }
        }
    }
}

/// One change of a plan.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    #[serde(skip)]
    pub target: Target,
    pub uid: u32,
    pub name: String,
    pub field: String,
    pub old: i64,
    pub new: i64,
}

/// A field of a target that the plan leaves alone, and why: the reason in English, and
/// its code with the values it names, so the app can say it in another language.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub uid: u32,
    pub name: String,
    pub field: String,
    pub reason: String,
    pub code: &'static str,
    pub params: BTreeMap<&'static str, String>,
}

#[derive(Debug, Clone, Default)]
pub struct Plan {
    pub planned: Vec<Planned>,
    pub skipped: Vec<Skipped>,
    /// Targets whose values already are what the operations would make them.
    pub unchanged: usize,
}

impl Session {
    /// Works out what `operations` would change for each of `targets` (with their
    /// names), from the values the game holds now. Nothing is written.
    pub fn plan_mass_edit(
        &self,
        targets: &[(Target, String)],
        operations: &[(Field, Operation)],
    ) -> Result<Plan, EditError> {
        for (field, operation) in operations {
            operation.check(field)?;
            // A field the editor would not write is refused once, not once for every target.
            if let Some(lock) = self.field_lock(field) {
                return Err(EditError::Locked { field: field.key.clone(), lock });
            }
        }
        let fields: Vec<Field> = operations.iter().map(|(field, _)| field.clone()).collect();
        let mut plan = Plan::default();
        for (target, name) in targets {
            let skip = |field: &Field, err: &EditError| Skipped {
                uid: target.uid,
                name: name.clone(),
                field: field.key.clone(),
                reason: err.to_string(),
                code: err.code(),
                params: err.params().into_iter().collect(),
            };
            let values = match self.read_fields(target, &fields) {
                Ok(values) => values,
                Err(err) => {
                    plan.skipped.extend(fields.iter().map(|field| skip(field, &err)));
                    continue;
                }
            };
            let mut changed = false;
            for ((field, operation), value) in operations.iter().zip(values) {
                let Some(old) = value else {
                    plan.skipped.push(skip(field, &EditError::NoRecord { field: field.key.clone() }));
                    continue;
                };
                if !field.is_plausible(old) {
                    plan.skipped.push(skip(field, &EditError::Implausible { field: field.key.clone(), value: old }));
                    continue;
                }
                if field.kind == Kind::Date && old == 0 {
                    plan.skipped.push(skip(field, &EditError::Unset { field: field.key.clone() }));
                    continue;
                }
                let new = operation.apply(field, old);
                if new != old {
                    changed = true;
                    plan.planned.push(Planned {
                        target: *target,
                        uid: target.uid,
                        name: name.clone(),
                        field: field.key.clone(),
                        old,
                        new,
                    });
                }
            }
            plan.unchanged += usize::from(!changed);
        }
        Ok(plan)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit::{Entity, fields};

    fn field(entity: Entity, key: &str) -> Field {
        let layout = crate::layout_for(27).expect("FM27 layout");
        fields(&layout, entity).into_iter().find(|f| f.key == key).expect(key)
    }

    #[test]
    fn operations_stay_in_range() {
        let finishing = field(Entity::Player, "attribute.finishing");
        assert_eq!(Operation::Add { amount: 10 }.apply(&finishing, 95), 100);
        assert_eq!(Operation::Add { amount: -10 }.apply(&finishing, 5), 1);
        assert_eq!(Operation::Scale { percent: 110 }.apply(&finishing, 50), 55);
        assert_eq!(Operation::Scale { percent: 150 }.apply(&finishing, 90), 100);
        let budget = field(Entity::Club, "finance.transfer_budget");
        assert_eq!(Operation::Scale { percent: 200 }.apply(&budget, 24_250_000), 48_500_000);
        assert_eq!(Operation::Set { value: 1_000_000 }.apply(&budget, 24_250_000), 1_000_000);
    }

    #[test]
    fn operations_are_checked_against_the_field() {
        let ca = field(Entity::Player, "current_ability");
        assert!(Operation::Set { value: 150 }.check(&ca).is_ok());
        assert!(Operation::Set { value: 250 }.check(&ca).is_err());
        let expires = field(Entity::Player, "contract.expires");
        assert!(Operation::Set { value: 20300630 }.check(&expires).is_ok());
        assert!(Operation::Add { amount: 10_000 }.check(&expires).is_err());
        assert!(Operation::Scale { percent: 110 }.check(&expires).is_err());
    }
}
