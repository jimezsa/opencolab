# Validation Checklist

Before returning the diagram, check all of these:

- Every must-include component from the request appears in the diagram.
- Every must-include relationship from the request appears in the diagram.
- No major component was invented without a clear basis in the request.
- The dominant flow direction is obvious.
- Containers reflect real subsystem boundaries rather than arbitrary grouping.
- Labels are short and readable.
- Only important edges are labeled.
- The diagram is not overcrowded.
- The `.d2` source validates successfully.
- The SVG renders successfully.
- If a PNG was requested, the PNG renders successfully.

If two or more checklist items fail, revise the `.d2` file and rerender once before replying.
