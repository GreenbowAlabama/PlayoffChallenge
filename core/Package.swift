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
            targets: ["core"]
        )
    ],
    targets: [
        .target(
            name: "core",
            dependencies: []
        ),
        .testTarget(
            name: "coreTests",
            dependencies: ["core"],
            resources: [.copy("Fixtures")]
        )
    ]
)
