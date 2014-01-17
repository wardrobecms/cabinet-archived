<?php namespace Wardrobe\Cabinet\Parsers;

use \Michelf\MarkdownExtra;

class MarkdownParser implements ParserInterface {

	/**
	 * Convert a string to markdown.
	 *
	 * @param $str
	 * @return mixed
	 */
	public function parse($str)
	{
		return MarkdownExtra::defaultTransform($str);
	}

} 
