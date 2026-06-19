# Spatial Quiz Ideas

## Core Idea

三视图不只是展示三维模型，也可以反过来作为推理题：给出一个视图，让学生推测可能的三维实体；再逐步给出第二个、第三个视图，候选造型逐渐收缩到唯一答案。

This can become a progressive spatial reasoning activity:

1. Show one orthographic view.
2. Offer several possible solids.
3. Add another view and remove incompatible solids.
4. Add the final view and converge to one answer.

## Primitive Library

Start with a small set of primitives:

- Cube / rectangular prism
- Cylinder
- Triangular prism / rib plate
- Sphere
- Through hole
- Slot
- Chamfer / inclined plane

## Example Reasoning Flow

### Step 1: One View

Given only the front view:

- A rectangle may be a rectangular prism.
- It may also be a cylinder seen from the side.
- It may be a slotted block whose slot is hidden in this view.

Question type:

> Which 3D objects could match this front view?

### Step 2: Two Views

Add the top view:

- Some objects are eliminated because depth or circular features disagree.
- Candidate count drops from many to a few.

Question type:

> Which candidates are still possible after adding the top view?

### Step 3: Three Views

Add the side view:

- The remaining ambiguity should collapse to one object.

Question type:

> Which object is the unique match?

## UI Proposal

Add a new mode later:

- `自由探索`: current 3D and three-view demo.
- `三视图推理`: hide one or more views and show candidate solids.

For mobile:

- Keep the unfold/merge button always visible.
- Put quiz choices in a bottom sheet.
- Avoid dense controls during the quiz.

## Implementation Notes

The current projection engine already generates views from 3D geometry. The quiz engine can reuse that pipeline:

- Predefine candidate models.
- Render their three views offscreen.
- Compare known view signatures or use curated answer sets.
- Start with manually authored questions before automatic generation.
