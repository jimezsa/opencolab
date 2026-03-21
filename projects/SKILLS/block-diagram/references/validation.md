# Validation Checklist

Before returning the diagram, check all of these:

- Every must-include component from the request appears in the diagram.
- Every must-include relationship from the request appears in the diagram.
- No major component was invented without a clear basis in the request.
- The dominant flow direction is obvious.
- The layout is compact and avoids unnecessarily long empty connections.
- Containers reflect real subsystem boundaries rather than arbitrary grouping.
- Labels are short and readable.
- Edges are unlabeled by default, and any remaining labels carry concrete meaning rather than generic `input` or `output` text.
- If a formula appears, it is materially relevant, concise, and rendered as a dedicated equation block.
- The diagram is not overcrowded.
- The render style matches the request, or defaults to `sketch` when no style was requested.
- The `.d2` source validates successfully.
- The SVG renders successfully.
- If a PNG was requested, the PNG renders successfully.

If two or more checklist items fail, revise the `.d2` file and rerender once before replying.
