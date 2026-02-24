//
//  MockContest.swift
//  PlayoffChallenge
//
//  Mock data for Contests used in Previews and Tests.
//

import Foundation
import Core

public struct MockContest {
    public static let samples: [Contest] = [
        Contest.stub(
            id: UUID(),
            contestName: "Championship Challenge",
            status: .scheduled
        ),
        Contest.stub(
            id: UUID(),
            contestName: "Playoff Bracket",
            status: .live
        ),
        Contest.stub(
            id: UUID(),
            contestName: "Completed Contest",
            status: .complete
        )
    ]

    public static func fixture(
        id: UUID = UUID(),
        name: String = "Fixture Contest",
        status: ContestStatus = .scheduled
    ) -> Contest {
        return Contest.stub(
            id: id,
            contestName: name,
            status: status
        )
    }
}
