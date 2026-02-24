#import <Foundation/Foundation.h>

#if __has_attribute(swift_private)
#define AC_SWIFT_PRIVATE __attribute__((swift_private))
#else
#define AC_SWIFT_PRIVATE
#endif

/// The resource bundle ID.
static NSString * const ACBundleID AC_SWIFT_PRIVATE = @"com.iancarter.PlayoffChallenge";

/// The "BrandBlack" asset catalog color resource.
static NSString * const ACColorNameBrandBlack AC_SWIFT_PRIVATE = @"BrandBlack";

/// The "BrandCream" asset catalog color resource.
static NSString * const ACColorNameBrandCream AC_SWIFT_PRIVATE = @"BrandCream";

/// The "BrandOrange" asset catalog color resource.
static NSString * const ACColorNameBrandOrange AC_SWIFT_PRIVATE = @"BrandOrange";

/// The "AppLogo" asset catalog image resource.
static NSString * const ACImageNameAppLogo AC_SWIFT_PRIVATE = @"AppLogo";

#undef AC_SWIFT_PRIVATE
