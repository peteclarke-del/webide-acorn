<?php

declare(strict_types=1);

/*
 * Formatting rules for the native build adapter.
 *
 * Deliberately not a preset. PSR-12 would rewrite this codebase's compact
 * single-line guards into multi-line blocks, which is a change of house style
 * dressed up as a standard and would bury every future diff under it. What is
 * enforced here is the set of things that are unambiguously right, that no
 * reader would argue about, and that a person can get wrong without noticing:
 * the strict-types declaration, imports that are used and ordered, consistent
 * quoting and spacing, and a file that ends the way every other one does.
 *
 * Run `composer format` to apply it and `composer format:check` to ask.
 */
return (new PhpCsFixer\Config())
    ->setRiskyAllowed(true)
    ->setRules([
        /* Every file declares strict types. A file that forgets silently
         * accepts a string where an int was asked for. */
        'declare_strict_types' => true,
        'blank_line_after_opening_tag' => true,

        /* Imports say what a file depends on, so an unused one is a lie about
         * that and an unordered list hides a duplicate. */
        'no_unused_imports' => true,
        'ordered_imports' => ['sort_algorithm' => 'alpha'],
        'fully_qualified_strict_types' => true,
        'single_line_after_imports' => true,
        'no_leading_import_slash' => true,

        /* Whitespace and punctuation nobody should have to think about. */
        'no_trailing_whitespace' => true,
        'no_trailing_whitespace_in_comment' => true,
        'single_blank_line_at_eof' => true,
        'no_whitespace_before_comma_in_array' => true,
        'whitespace_after_comma_in_array' => true,
        'trim_array_spaces' => true,
        'no_spaces_around_offset' => true,
        'normalize_index_brace' => true,
        'no_empty_statement' => true,
        'no_useless_else' => true,
        'no_useless_return' => true,
        'trailing_comma_in_multiline' => ['elements' => ['arrays', 'arguments', 'parameters']],

        /* Consistent spelling of the language itself. */
        'single_quote' => true,
        'lowercase_keywords' => true,
        'lowercase_static_reference' => true,
        'constant_case' => true,
        'short_scalar_cast' => true,
        'cast_spaces' => true,
        'binary_operator_spaces' => ['default' => 'single_space'],
        'concat_space' => ['spacing' => 'none'],
        'unary_operator_spaces' => true,
        'not_operator_with_successor_space' => false,
        'visibility_required' => ['elements' => ['property', 'method', 'const']],
        'array_syntax' => ['syntax' => 'short'],
        'list_syntax' => ['syntax' => 'short'],
    ])
    ->setFinder(
        PhpCsFixer\Finder::create()
            ->in([__DIR__.'/src', __DIR__.'/tests'])
            ->append([__FILE__]),
    );
