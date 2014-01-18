<?php namespace Wardrobe\Cabinet\Parsers;

use \Michelf\MarkdownExtra as Markdown;

class MarkdownParser implements ParserInterface {

	protected $markdown;

	public function __construct(Markdown $markdown)
	{
		$this->markdown = $markdown;
	}

	/**
	 * Convert a string to markdown.
	 *
	 * @param $str
	 * @return mixed
	 */
	public function parse($str)
	{
		return $this->markdown->defaultTransform($str);
	}
}
