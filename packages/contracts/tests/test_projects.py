def test_contract_starts_empty(chain):
    assert chain.contract.get_config() == [0, 3, 3, 4, 3, 72 * 60 * 60]
    assert chain.contract.get_project_count() == 0
