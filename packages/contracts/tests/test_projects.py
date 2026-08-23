import genlayer as gl


def test_contract_starts_empty(chain):
    assert chain.contract.get_config() == [0, 3, 3, 4, 3, 72 * 60 * 60]
    assert chain.contract.get_project_count() == 0


def test_runtime_message_sender_accessor_tracks_writes(chain):
    replacement = gl.Address("0x4000000000000000000000000000000000000004")
    another = gl.Address("0x5000000000000000000000000000000000000005")

    assert gl.message.sender_address == gl.Address("0x1000000000000000000000000000000000000001")

    gl.message.sender_address = replacement

    assert gl.message.sender_address == replacement

    gl.set_sender(another)

    assert gl.message.sender_address == another


def test_runtime_message_raw_datetime_accessor_tracks_writes(chain):
    assert gl.message_raw.datetime == 0

    gl.message_raw.datetime = 1_900_000_123

    assert gl.message_raw.datetime == 1_900_000_123

    gl.set_now(1_900_000_456)

    assert gl.message_raw.datetime == 1_900_000_456
