describe('pgaEspnIngestion module resolution', () => {
  it('should load without module errors', () => {
    expect(() => {
      require('../../services/ingestion/strategies/pgaEspnIngestion');
    }).not.toThrow();
  });
});
