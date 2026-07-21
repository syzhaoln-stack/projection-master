"""Generate the mechanical STEP sample used by the browser import regression test."""

from pathlib import Path

import cadquery as cq


def build_bearing_block() -> cq.Workplane:
    base = cq.Workplane("XY").box(96, 56, 12, centered=(True, True, False))
    web = (
        cq.Workplane("XY")
        .box(56, 20, 44, centered=(True, True, False))
        .translate((0, 0, 12))
    )
    boss = (
        cq.Workplane("XZ")
        .center(0, 34)
        .circle(18)
        .extrude(28, both=True)
    )
    part = base.union(web).union(boss)

    bore = (
        cq.Workplane("XZ")
        .center(0, 34)
        .circle(10)
        .extrude(40, both=True)
    )
    part = part.cut(bore)

    for x in (-36, 36):
        mounting_hole = (
            cq.Workplane("XY")
            .center(x, 0)
            .circle(4.5)
            .extrude(14)
            .translate((0, 0, -1))
        )
        part = part.cut(mounting_hole)

    return part


def main() -> None:
    output = Path(__file__).resolve().parents[1] / "assets" / "step_bearing_block.step"
    output.parent.mkdir(parents=True, exist_ok=True)
    cq.exporters.export(build_bearing_block(), str(output), exportType="STEP")
    normalized = "\n".join(line.rstrip() for line in output.read_text(encoding="ascii").splitlines()) + "\n"
    output.write_text(normalized, encoding="ascii", newline="\n")
    print(output)


if __name__ == "__main__":
    main()
