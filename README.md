
# beautifulmind

[![MIT License][license-shield]][license-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]

the tool to train thinking. similiar to anki-cards, but with maximum focus-oriented. by author's opinion re-membering subject must occur on the battlefield 
where you have many pieces of puzzle;
the best way to do it, no doubts, solve challenges or practicing 
the whole software is designed to make this possibly in just simple game format

## features 
- srs-algorithm & recall
- local-first 
- embeddings & cosine correlation between cards

## stack

- tauri+node+ts+sqlite

## deck protocol

knowledge is defined simply in `.yaml` files located in the `/decks` directory. The structure is strict

```yaml
deckID: "unique-deck-identifier-v1"

concepts:
  - id: "concept_unique_id_1"
    name: "Concept Name"
    description: "A brief description of the concept."

cards:
  - id: temp_card_id_for_linking # This is a TEMPORARY ID used only for linking within this file.
    concept_id: "concept_unique_id_1"
    card_type: "Thesis" # or "Evidence" or "Definition"
    title: "Card Title"
    content: "The body of the card. Supports Markdown, LaTeX, and images."

links:
  - source: temp_card_id_for_linking_1
    target: temp_card_id_for_linking_2
    type: "SUPPORTS" # or "REFUTES"
```

#### Key Points:

-   **`concepts`**: high-level ideas. the system uses these to find related cards for infinite journeys.
-   **`cards.id`**: **temporary ID**. you must define it, and it must be unique *within the file*. Its only purpose is to be referenced by the `links` section. When the system syncs, it will ignore this ID and generate a permanent, content-hashed SHA1 ID.
-   **`links`**: defines structure of your graph. connects evidence to a thesis.

## Card Content Spec

The `content` field for cards is powerful.

#### Block LaTeX: `$$...$$`

Rendered in display mode (centered, larger).
```yaml
content: |
  The formula for Gaussian integration is:
  $$
  \int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
  $$
```

#### Inline LaTeX: `$...$`

Rendered inline with text.
```yaml
content: The equation $E=mc^2$ changed the world.
```

#### LaTeX Escaping

because this is YAML, backslashes must often be escaped. Write `\\` for a single `\` in your LaTeX. 
the renderer will fix it
```yaml
# Correct way to write \sum in YAML
content: $$ \\sum_{i=1}^{n} i $$
```

#### Images: `![alt](src)`

-   **Remote:** Just use the full URL.
    ```yaml
    content: ![A dog from the web](https://images.unsplash.com/photo-1583511655857-d19b40a7a54e)
    ```
-   **Local:** The path must be relative to your **`src-tauri`** directory. It's recommended to create an `assets` folder inside `src-tauri`.
    ```yaml
    # if your image is at src-tauri/assets/diagram.png
    content: ![My Diagram](assets/diagram.png)
    ```

---


<!-- MARKDOWN LINKS & BADGE DEFINITIONS -->
[license-shield]: https://img.shields.io/github/license/vasillieux/beautifulmind?style=for-the-badge
[license-url]: https://github.com/vasillieux/beautifulmind/blob/master/LICENSE
[stars-shield]: https://img.shields.io/github/stars/vasillieux/beautifulmind?style=for-the-badge
[stars-url]: https://github.com/vasillieux/beautifulmind/stargazers
[issues-shield]: https://img.shields.io/github/issues/vasillieux/beautifulmind?style=for-the-badge
[issues-url]: https://github.com/vasillieux/beautifulmind/issues