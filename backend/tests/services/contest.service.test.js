/**
 * Contest Service Deprecation Guard Test
 *
 * The original contestService.js has been deprecated. It referenced
 * non-existent tables (contests, contest_entries) and has been replaced
 * by customContestService.js.
 *
 * This test ensures the deprecation guard remains active: importing
 * contestService.js must throw immediately, preventing accidental usage.
 */

describe('contestService.js deprecation guard', () => {
  it('should throw on import with clear deprecation message', () => {
    expect(() => {
      require('../../services/contestService');
    }).toThrow('contestService.js is deprecated and must not be imported');
  });

  it('should direct users to customContestService', () => {
    expect(() => {
      require('../../services/contestService');
    }).toThrow('Use customContestService.js instead');
  });
});
