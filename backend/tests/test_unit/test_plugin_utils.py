from app.services.plugin_utils import int_list, int_or_none


def test_int_or_none_returns_int():
    assert int_or_none(5) == 5
    assert int_or_none("7") == 7


def test_int_or_none_returns_none_on_invalid():
    assert int_or_none(None) is None
    assert int_or_none("abc") is None
    assert int_or_none([]) is None


def test_int_list_filters_valid():
    assert int_list([1, "2", None, "bad", 3.9]) == [1, 2, 3]


def test_int_list_returns_empty_for_non_list():
    assert int_list(None) == []
    assert int_list("123") == []
    assert int_list(42) == []


def test_int_list_empty_input():
    assert int_list([]) == []
