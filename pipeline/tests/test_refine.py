from pipeline.refine import risky, windows


def test_hidden_ridge_and_wrap():
    h = [0.0] * 360
    h[0] = 2
    assert risky({"az": 359, "el": 1}, {"az": 1, "el": 1}, h, 0)
    assert risky({"az": 1, "el": 1}, {"az": 359, "el": 1}, h, 0)
    assert not risky({"az": 10, "el": 5}, {"az": 11, "el": 5}, h, 0)


def test_windows_pad_merge_and_include_flat_case():
    samples = [{"t": str(i), "az": 0, "el": el} for i, el in enumerate([5, 5, 1, -1, -5, -5])]
    assert windows(samples, [], 0) == [("1", "4")]
