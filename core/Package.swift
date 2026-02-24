// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Core",
    platforms: [
        .iOS(.v16),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "Core",
            targets: ["Core"]   // ← FIXED
        )
    ],
    targets: [
        .target(
            name: "Core",      // ← uppercase
            dependencies: []
        ),
        .testTarget(
            name: "coreTests",
            dependencies: ["Core"],
            resources: [.copy("Fixtures")]
        )
    ]
)