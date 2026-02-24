import re
import os

def process_delete_unjoin():
    path = "core/Tests/coreTests/DeleteUnjoinMutationTests.swift"
    with open(path, "r") as f:
        content = f.read()

    # Add extension
    extension_code = """
import XCTest
@testable import core

extension LeaderboardRowContract {
    /// Provides subscript access to any field as AnyCodable for backward-compatible tests
    subscript(key: String) -> AnyCodable? {
        let mirror = Mirror(reflecting: self)
        return mirror.children.first { $0.label == key }?.value as? AnyCodable
    }
}
"""
    content = content.replace("import XCTest\n@testable import core", extension_code)

    # Replace makeContestActions
    make_contest_actions_old = """    func makeContestActions(
        can_delete: Bool,
        can_unjoin: Bool,
        other_can_join: Bool = false,
        other_can_edit_entry: Bool = false
    ) -> ContestActions {
        ContestActions(
            can_join: other_can_join,
            can_edit_entry: other_can_edit_entry,
            is_live: false,
            is_closed: false,
            is_scoring: false,
            is_scored: false,
            is_read_only: false,
            can_share_invite: false,
            can_manage_contest: false,
            can_delete: can_delete,
            can_unjoin: can_unjoin
        )
    }"""
    make_contest_actions_new = """    func makeContestActions(
        canDelete: Bool,
        canUnjoin: Bool,
        otherCanJoin: Bool = false,
        otherCanEditEntry: Bool = false
    ) -> ContestActions {
        ContestActions(
            canJoin: otherCanJoin,
            canEditEntry: otherCanEditEntry,
            isLive: false,
            isClosed: false,
            isScoring: false,
            isScored: false,
            isReadOnly: false,
            canShareInvite: false,
            canManageContest: false,
            canDelete: canDelete,
            canUnjoin: canUnjoin
        )
    }"""
    content = content.replace(make_contest_actions_old, make_contest_actions_new)

    # Change decode to decode contract and then map it, OR update test asserts
    # The prompt explicitly said to update assertions to camelCase.
    # Replace `actions.can_delete` -> `actions.canDelete`, etc.
    replacements = [
        ("actions.can_join", "actions.canJoin"),
        ("actions.can_edit_entry", "actions.canEditEntry"),
        ("actions.is_live", "actions.isLive"),
        ("actions.is_closed", "actions.isClosed"),
        ("actions.is_scoring", "actions.isScoring"),
        ("actions.is_scored", "actions.isScored"),
        ("actions.is_read_only", "actions.isReadOnly"),
        ("actions.can_share_invite", "actions.canShareInvite"),
        ("actions.can_manage_contest", "actions.canManageContest"),
        ("actions.can_delete", "actions.canDelete"),
        ("actions.can_unjoin", "actions.canUnjoin"),
        ("contract.actions.can_join", "contract.actions.canJoin"),
        ("contract.actions.can_edit_entry", "contract.actions.canEditEntry"),
        ("contract.actions.is_live", "contract.actions.isLive"),
        ("contract.actions.is_closed", "contract.actions.isClosed"),
        ("contract.actions.is_scoring", "contract.actions.isScoring"),
        ("contract.actions.is_scored", "contract.actions.isScored"),
        ("contract.actions.is_read_only", "contract.actions.isReadOnly"),
        ("contract.actions.can_share_invite", "contract.actions.canShareInvite"),
        ("contract.actions.can_manage_contest", "contract.actions.canManageContest"),
        ("contract.actions.can_delete", "contract.actions.canDelete"),
        ("contract.actions.can_unjoin", "contract.actions.canUnjoin"),
        ("decodeContestActions", "decodeContestActionsContract"),
    ]
    for old, new in replacements:
        content = content.replace(old, new)
        
    content = content.replace("try decoder.decode(ContestActions.self, from: json)", "ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))")
    content = content.replace("try JSONDecoder().decode(ContestActions.self, from: data)", "ContestActions.from(try JSONDecoder().decode(ContestActionsContract.self, from: data))")

    with open(path, "w") as f:
        f.write(content)

def process_contract_strictness():
    path = "core/Tests/coreTests/ContractStrictnessTests.swift"
    with open(path, "r") as f:
        content = f.read()

    replacements = [
        ("actions.can_join", "actions.canJoin"),
        ("actions.can_edit_entry", "actions.canEditEntry"),
        ("actions.is_live", "actions.isLive"),
        ("actions.is_closed", "actions.isClosed"),
        ("actions.is_scoring", "actions.isScoring"),
        ("actions.is_scored", "actions.isScored"),
        ("actions.is_read_only", "actions.isReadOnly"),
        ("actions.can_share_invite", "actions.canShareInvite"),
        ("actions.can_manage_contest", "actions.canManageContest"),
        ("actions.can_delete", "actions.canDelete"),
        ("actions.can_unjoin", "actions.canUnjoin"),
        ("contract.actions.can_join", "contract.actions.canJoin"),
        ("contract.actions.can_edit_entry", "contract.actions.canEditEntry"),
        ("contract.actions.is_live", "contract.actions.isLive"),
        ("contract.actions.is_closed", "contract.actions.isClosed"),
        ("contract.actions.is_scoring", "contract.actions.isScoring"),
        ("contract.actions.is_scored", "contract.actions.isScored"),
        ("contract.actions.is_read_only", "contract.actions.isReadOnly"),
        ("contract.actions.can_share_invite", "contract.actions.canShareInvite"),
        ("contract.actions.can_manage_contest", "contract.actions.canManageContest"),
        ("contract.actions.can_delete", "contract.actions.canDelete"),
        ("contract.actions.can_unjoin", "contract.actions.canUnjoin"),
    ]
    for old, new in replacements:
        content = content.replace(old, new)
        
    content = content.replace("try decoder.decode(ContestActions.self, from: json)", "try decoder.decode(ContestActionsContract.self, from: json)")

    with open(path, "w") as f:
        f.write(content)

def process_adversarial():
    pass # No string replacements required, subscript was added to extension in DeleteUnjoinMutationTests

process_delete_unjoin()
process_contract_strictness()
