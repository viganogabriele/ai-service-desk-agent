from triage.evidence import locate_quote, locate_quotes

REC = {
    "Summary": "Allocation rejects",
    "Description": "Since 07:40 CET the adapter has rejected every  block allocation\nfor the new broker.",
    "All Comments": ["x@intcom.com: Only the new broker fails."],
}


def _check(span):
    assert REC_FIELDS[span.field][span.start:span.end] == span.text


REC_FIELDS = {"Summary": REC["Summary"], "Description": REC["Description"], "All Comments[0]": REC["All Comments"][0]}


def test_exact_and_case_insensitive():
    s = locate_quote(REC, "rejected every")
    assert s.field == "Description" and s.text == "rejected every"
    _check(s)
    s = locate_quote(REC, "ALLOCATION REJECTS")
    assert s.field == "Summary" and s.start == 0
    _check(s)


def test_whitespace_and_surrounding_punctuation_tolerated():
    s = locate_quote(REC, '"every block allocation for the new broker."')
    assert s.field == "Description" and "\n" in s.text
    _check(s)


def test_comment_positions_index_the_raw_comment():
    s = locate_quote(REC, "only the new broker fails")
    assert s.field == "All Comments[0]"
    _check(s)


def test_paraphrases_are_dropped_and_duplicates_merged():
    spans, missing = locate_quotes(REC, ["rejected every", "Rejected  every", "broker was misconfigured", ""])
    assert len(spans) == 1 and missing == ["broker was misconfigured", ""]
