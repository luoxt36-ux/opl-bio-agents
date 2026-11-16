# Evaluation design

Use `oma-target-assessment-eval-design` to embed an `EvalSpec` in the blueprint. Define public cases, protected requirement categories, measurable gates, baseline comparison, and mandatory independent evaluation. Preserve existing tests and thresholds for takeover/improve. Cover production-contract and effective-role-prompt reachability for every new or changed action contract, output member, quality transport, or role-scoped prompt obligation.

For every `DesignRequest.constraints.privacy_requirements` entry, include one protected requirement whose `category` is the exact unchanged request string and whose `minimum_case_count` is positive. Additional broader privacy categories may supplement but never replace those exact entries.

Add `professional-skill-consumption-reachability` when a stage or action declares a professional Skill dependency. Bind the Skill identity, version, and content ref from effective-role selection through OPL production evidence to the Skill-owned behavioral rubric. OMA specifies the obligation; OPL owns evidence binding, execution, and the verdict.

Return the complete final `AgentBlueprint`; do not execute evaluation or claim qualification.

Treat the incoming draft blueprint and every other input artifact as immutable.
When the StageRun transport requires a local artifact, write the completed
blueprint to an attempt-scoped new path such as
`stage-artifacts/<OPL_STAGE_ATTEMPT_ID>/agent-blueprint-final.json`; never
overwrite, rename, or reuse the path of the draft artifact. Return the exact new
ref and hash so OPL can verify both the immutable input snapshot and the derived
final snapshot.
