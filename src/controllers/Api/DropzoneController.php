<?php namespace Wardrobe\Cabinet\Controllers\Api;

use Controller;
use Input, Config, Response, File;
use Intervention\Image\Image;

class DropzoneController extends Controller {

	/**
	 * Create a new API Dropzone controller.
	 *
	 * @return \Wardrobe\Cabinet\Controllers\Api\DropzoneController
	 */
	public function __construct()
	{
		$this->beforeFilter('wardrobe.auth');
	}

	/**
	 * Upload a big post image
	 *
	 * @return mixed
	 */
	public function postLeader()
	{
		$file = Input::file('file');
		$imageDir = Config::get('wardrobe.image_dir', 'img');
		$destinationPath = public_path(). "/" . $imageDir ."/";
		$filename = $file->getClientOriginalName();

		$file->move($destinationPath, $filename);

		if (File::exists($destinationPath.$filename))
		{
			return Response::json(['filename' => "/{$imageDir}/".$filename]);
		}

		return Response::json(array('error' => 'Upload failed. Please ensure your public/'.$imageDir.' directory is writable.'));
	}

	/**
	 * Post an image from the admin
	 *
	 * @return Json
	 */
	public function postImage()
	{
		$file = Input::file('file');
		$imageDir = Config::get('wardrobe.image_dir', 'img');
		$destinationPath = public_path(). "/" . $imageDir ."/";
		$filename = $file->getClientOriginalName();
		$resizeEnabled = Config::get('wardrobe.image_resize.enabled', false);
		
		if ($resizeEnabled)
		{
			$resizeWidth = Config::get('wardrobe.image_resize.width');
			$resizeHeight = Config::get('wardrobe.image_resize.height');
			$image = Image::make($file->getRealPath())->resize($resizeWidth, $resizeHeight, true);
			$image->save($destinationPath.$filename);
		}
		else
		{
			$file->move($destinationPath, $filename);
		}

		if (File::exists($destinationPath.$filename))
		{
			return Response::json(array('filename' => "/{$imageDir}/".$filename));
		}
		return Response::json(array('error' => 'Upload failed. Please ensure your public/'.$imageDir.' directory is writable.'));
	}
}
