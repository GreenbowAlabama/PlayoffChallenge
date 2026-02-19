// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "core",
    platforms: [
        .iOS(.v13)
    ],
    products: [
        .library(
            name: "core",
            targets: ["core"]
        ),
    ],
    targets: [
        .target(
            name: "core"
        ),
        .testTarget(
            name: "coreTests",
            dependencies: ["core"]
        ),
    ]
)
